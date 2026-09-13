# X/Twitter Bookmark Folders — internal GraphQL API (validated 2026-08-24)

Bookmark Folders are Premium+ only, and on some accounts the UI exists ONLY in the mobile app — desktop web shows no folder UI at all. But the full API works from the web session. Validated end-to-end: create folder, list, add tweet, remove tweet, delete folder, read folder timeline.

## Endpoints (queryIds valid as of 2026-08-24; they rotate — re-extract if 404)

| Opération | queryId | Variables |
|---|---|---|
| List folders | `i78YDd0Tza-dV4SYs58kRg` BookmarkFoldersSlice | `{"count":100}` (GET) |
| Create folder | `6Xxqpq8TM_CREYiuof_h5w` createBookmarkFolder | `{"name":"..."}` (POST mutation) |
| Add tweet to folder | `4KHZvvNbHNf07bsgnL9gWA` bookmarkTweetToFolder | `{"tweet_id":"...","bookmark_collection_id":"..."}` |
| Remove tweet | `2Qbj9XZvtUvyJB4gFwWfaA` RemoveTweetFromBookmarkFolder | same vars |
| Delete folder | `2UTTsO-6zs93XqlEUZPsSg` DeleteBookmarkFolder | `{"bookmark_collection_id":"..."}` |
| Folder timeline | `U16iHLDthyj_mXaEbCuaaQ` BookmarkFolderTimeline | `{"bookmark_collection_id":"...","count":20,...}` |

- The collection ID field is **`bookmark_collection_id`** — NOT `bookmark_folder_id` (422 GRAPHQL_VALIDATION_FAILED "must be defined" otherwise).
- Mutations body: `JSON.stringify({variables: JSON.stringify({...}), queryId})` — variables is a JSON-encoded string inside the body.
- GET queries: `/i/api/graphql/<qid>/<Name>?variables=<urlencoded>`.

## Getting auth headers right

The public bearer token is LONG and commonly truncated in docs/memory. A truncated bearer → 401 "Invalid or expired token" (code 89), which looks like an auth problem but is just a cut-off string. Known-good tail: `...1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA`.

Reliable capture of exact headers the app itself uses:

```js
// install hook BEFORE triggering any graphql request
window.__captured = null;
const origOpen = XMLHttpRequest.prototype.open,
      origSetHeader = XMLHttpRequest.prototype.setRequestHeader,
      origSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open = function(m,u){ this.__url=u; this.__headers={}; return origOpen.apply(this,arguments); };
XMLHttpRequest.prototype.setRequestHeader = function(k,v){ if(this.__headers) this.__headers[k]=v; return origSetHeader.apply(this,arguments); };
XMLHttpRequest.prototype.send = function(){ if(this.__url && this.__url.includes('/graphql/')) window.__captured={headers:this.__headers}; return origSend.apply(this,arguments); };
```

Then trigger any SPA navigation (e.g. click the Likes tab link) to fire a graphql XHR, and read `window.__captured.headers`. Use `authorization` + `x-csrf-token` + `credentials: 'include'`. Note `ct0` is NOT httpOnly but matching the app's own header values beats reconstructing them.

## Extracting queryIds when they rotate

QueryIds live in lazy-loaded webpack chunks, not the main bundle. Extraction trick (run via js() on any x.com page):

```js
(() => {
  let req;
  window.webpackChunk_twitter_responsive_web.push([[Math.random()], {}, (r) => { req = r; }]);
  const found = {};
  for (const id of Object.keys(req.m)) {
    try {
      const s = JSON.stringify(req(id));
      if (!s || !s.includes('Bookmark')) continue;
      const re = /queryId":"?([a-zA-Z0-9_-]+)"?,"operationName":"?(Bookmark[A-Za-z]*)/g;
      let m;
      while ((m = re.exec(s)) !== null) found[m[2]] = m[1];
    } catch(e){}
  }
  return found;
})()
```

Caveat: only chunks already loaded are visible. If folder ops are missing, fetch candidate chunk URLs from `link[href*=".js"]` tags (names like `bundle.BookmarkFolders.*.js`) and scan their text for `{queryId:"...",operationName:"..."}`.

## Bulk operations (280 tweets sorted, 0 errors)

- Persist the plan (`{id, folder}` array) into `window.__sortPlan` by concatenating ~70-item chunks via repeated js() calls.
- Keep mutable progress in `window.__sortDone = {ok, err:[], i}` so work survives CDP timeouts.
- **Batch size ≤5 requests per js() evaluation**: each request has a random 350–800ms pause; 8+ requests (~7s+) exceeds the harness's CDP Runtime.evaluate timeout (~30s incl. overhead was fine at ≤5, flaky at 8 with extra latency). Loop batches from Python.
- Watch the loop break condition: `(done.i + 1) % N === 0` breaks immediately when i starts exactly at a multiple boundary — use a `processed` counter instead.
- In browser_exec Python, don't shadow harness builtins (`round`, etc.) with loop variables.

## Live deployment state

Folders created 2026-08-24: AI & Agents, Dev, Design, Business, Productivité, À lire → IDs persisted in `~/.hermes/bookmarks-agent/state/x_folders.json`. All 280 existing bookmarks sorted retroactively; cron `c1a50f22fd97` files new ones daily.
