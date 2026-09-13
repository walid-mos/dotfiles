# Reference: X/Twitter Bookmarks Curator (live deployment)

Deployed 2026-08-23 for user @dev_au_bonnet.

## Facts discovered

- **X merged Bookmarks into `/i/history`** — the sidebar entry "Bookmarks" points there; `https://x.com/i/bookmarks` redirects to it. Likes live at `/i/history/likes`.
- Working extractor JS (via browser_exec `js()`):

```js
(() => {
  const out = [];
  for (const a of document.querySelectorAll('article[data-testid="tweet"]')) {
    const timeEl = a.querySelector('time');
    let permalink = null;
    for (const l of a.querySelectorAll('a[href*="/status/"]')) permalink = l.href;
    if (!permalink) continue;
    const txt = a.querySelector('[data-testid="tweetText"]');
    out.push({
      id: permalink.split('/status/')[1].split('/')[0],
      author: (permalink.split('x.com/')[1] || '').split('/status')[0].split('?')[0],
      url: permalink,
      date: timeEl ? timeEl.getAttribute('datetime') : null,
      text: txt ? txt.innerText : ''
    });
  }
  return out;
})()
```

- Author from innerText selectors (`a[data-testid="User-Name"]`) returns empty strings; splitting the permalink URL is reliable.
- Permalinks on this page end with `/analytics` — strip before storing.
- Initial full scroll captured 279 bookmarks in ~60 iterations at 2.2s pauses (~2.5 min).
- Cookies worth saving to Keychain: `auth_token`, `ct0`, `twid`. Service name used: `hermes-bookmarks-agent-x`.
- Chrome remote-debugging first-time setup requires user to click "Allow remote debugging" popup + tick chrome://inspect authorization, then ONE more Allow popup on harness connect. One-time cost per session.

## Deployment layout

```
~/.hermes/bookmarks-agent/
  README.md            pipeline description
  build_vault.py       deterministic rebuild of Obsidian digests from data/full JSON
  state/state.json     known_ids (dedupe), last_run
  data/bookmarks_full.json   canonical merged dataset
```

Cron job id: `c1a50f22fd97`, daily 06:00, deliver origin. Watchdog: silent if no new IDs.

## Vault output conventions (Brain vault)

- Destination `5. Reference/Twitter Bookmarks/`; monthly digest files `<YYYY-MM>.md` + hub spine `Twitter Bookmarks.md` (tag #hub) with priority matrix (actif/veille counts), theme table, month index.
- Classification v1 is keyword regex → themes {ai-agents, dev, design, productivite, business, devops-infra, non-classe}; priority heuristic: tool/guide/repo keywords → actif, else veille. Upgrade path: LLM classification per batch.
