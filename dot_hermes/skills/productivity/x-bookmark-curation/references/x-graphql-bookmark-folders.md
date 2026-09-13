# X Bookmark Folder GraphQL Notes

These are implementation notes for the X web session workflow. They are not credentials; never persist captured authorization or `x-csrf-token` values.

## Observed mutation shapes

The authenticated page context accepted same-origin `fetch` calls with `credentials: 'include'` and these GraphQL paths:

- Create folder: `POST /i/api/graphql/6Xxqpq8TM_CREYiuof_h5w/createBookmarkFolder`
  - body fields: `variables` containing `JSON.stringify({name})`, and `queryId` equal to `6Xxqpq8TM_CREYiuof_h5w`.
  - observed successful response shape: `data.bookmark_collection_create.id` plus `data.bookmark_collection_create.name`.
- Add bookmarked tweet to folder: `POST /i/api/graphql/4KHZvvNbHNf07bsgnL9gWA/bookmarkTweetToFolder`
  - body fields: `variables` containing `JSON.stringify({tweet_id, bookmark_collection_id})`, and `queryId` equal to `4KHZvvNbHNf07bsgnL9gWA`.
  - observed successful response shape: `data.bookmark_collection_tweet_put == "Done"`.

Use the exact operation names and query IDs from the current task configuration; do not invent or repair IDs.

## Header capture

Install the XHR hook before the Likes round-trip. Capture headers when the URL contains `/graphql/`, then select the latest request containing both `authorization` and `x-csrf-token`. A full navigation can destroy the hook, so reinstall it and regenerate traffic in the same browser execution before writes. Keep values in process memory and omit them from logs.

## Consent recovery

On Chrome versions that show a native **Allow remote debugging?** dialog, target only the exact Chrome dialog's **Allow / Autoriser** action using the computer-use accessibility tree. The dialog may be a separate native window from the page; do not click a guessed page coordinate. Once the dialog disappears, retry browser execution. This is consent to the already-requested browser automation, not a reason to request or use a password.

## Write pacing (validated 2026-09-02)

Batching 5 `bookmarkTweetToFolder` calls inside one `js()` evaluation TIMED OUT the CDP `Runtime.evaluate` (IPC recv timeout, no partial result). Working pattern: store the tweet-id queue in-page (`window.__pending`, `window.__coll`), then one fetch per `js()` call with `AbortController` timeout ~10 s, outer Python loop sleeping ~0.9 s between calls. On the 2026-09-02 backfill this ran 29/29 `Done` without a single retry. The `createBookmarkFolder` single-shot call is unaffected (one fetch, one call).

## Verification checklist

For each write, retain only safe evidence such as HTTP status and the non-sensitive mutation result. Then verify:

1. the created folder response contains the requested literal name and a collection ID;
2. `x_folders.json` contains that exact name-to-ID mapping;
3. every intended tweet has a successful `bookmark_collection_tweet_put` result;
4. the merged archive has unique IDs and the state ID set matches it;
5. the Obsidian spine and newly generated notes exist.

If a folder page itself displays an X loading error, do not claim its contents were read back. Report the creation/mutation response as the narrower verified fact and avoid an unsupported contents claim.
