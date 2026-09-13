---
name: browser-capture-agents
description: Use when building cron agents that scrape user web content.
---

# Browser capture agents (cron scrapers of personal content)

Use when building an agent that periodically captures a user's saved/bookmarked content from a social platform (X/Twitter, TikTok, Reddit saves…) and archives it long-term.

## Architecture (validated pattern)

1. **Cron Hermes job** (`cronjob`, e.g. daily 06h), watchdog style: silent exit if nothing new, short report otherwise. Prompt must be fully self-contained (fresh session, no chat context).
2. **Capture via browser_exec on the user's real Chrome session** (remote-debugging harness). NOT headless: headless Chrome fingerprints badly against bot detection (X especially). Background tab = invisible to user AND credible to the site.
3. **Incremental state**: persist processed IDs in `<agent-dir>/state/state.json`; scroll only until a known ID appears. Cap scroll iterations (~100) and pause ~2s between scrolls to stay discreet.
4. **Archive**: merge raw runs into one canonical JSON (`data/full.json`), then a deterministic build script regenerates the destination (monthly digest notes + hub spine for Obsidian). Rebuild-from-full avoids partial-run overwrites corrupting digests.
5. **Session fallback**: store cookies (`auth_token`, `ct0`, …) in macOS Keychain via `security add-generic-password -U -s "<agent>-x"`; never plaintext files, never passwords. If page redirects to login, stop and report — do not retry loops.

## Extraction pattern (X/Twitter example)

- Select DOM nodes (`article[data-testid="tweet"]`), derive id/author by splitting the permalink href — more reliable than innerText selectors which return empty.
- Scroll loop until `body.scrollHeight` stalls 4 consecutive times = end of feed.
- Strip tracking suffixes from permalinks before storing (X appends `/analytics`).

## Pitfalls

- **Platform URL renames**: X merged Bookmarks into `/i/history` (`/i/bookmarks` redirects). Verify current URLs at build time instead of trusting memory.
- Cron jobs created with default `deliver` may be local-only (no notification); set deliver explicitly after creation if the user should see reports.
- Never modify account state during capture (read-only: no like/RT/delete).
- First run is supervised with the user present (login + remote-debugging approval popup); subsequent cron runs need zero interaction.

## Existing deployments

- `~/.hermes/bookmarks-agent/` — X bookmarks → Obsidian Brain `5. Reference/Twitter Bookmarks/`. Details in references/x-twitter-bookmarks.md.
