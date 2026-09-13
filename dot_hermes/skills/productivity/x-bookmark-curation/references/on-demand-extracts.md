# On-demand extracts over the bookmarks archive

Validated method for user-requested themed extracts over `~/.hermes/bookmarks-agent/data/bookmarks_full.json` (no X browsing, no sync). First use: 2026-09-02, extract "system prompts & harness" for the Pi prompt optimization (deliverable: `~/Documents/Hermes/Social Network/x-growth/pi-system-prompt-extract-2026-09-02.md`).

## Hard rule: judgment first, regex NEVER for selection (Walid, 2026-09-02)

Walid rejected the first-pass extract built with regex keyword pre-filtering ("c'est naze... trop déterministe"): keyword selection misses good tweets outside its vocabulary and pulls noise inside it (image prompts, marketing hype). The regex `classify()` inside `build_vault.py` is a legacy FALLBACK only — never a selection method for extracts.

For extracts, EVERY tweet must be judged individually by a model reading its full text. Deterministic tooling (Python) is fine for splitting, merging, counting, verifying — never for judging.

## Validated method: parallel judgment over the full archive

1. **Split** the archive (sorted by date) into N batch files (~90 tweets each) in a workdir, e.g. `review-batches/batch-N.json`.
2. **Fan out N subagents** (`delegate_task`, parallel) with a self-contained brief per batch: judge EACH tweet on its real domain, pick ONE category from the exact 8-folder list (`Carrer` — keep exact spelling, `AI & Agents`, `Dev`, `Design`, `Productivité`, `Business`, `À checker` — tools/repos/demos/services to test, NOT reading material, `À lire` — reading content only), disambiguate by intent ("what is this for Walid — solo dev building with AI agents?"), write `judged-N.json` as a JSON list of `{"id", "category"}` with exactly the batch's entry count, ids unique and matching the batch.
3. **Anti-timeout procedure (bit batch 2 on the first run, 2026-09-02):** instruct each subagent to write its judged file INCREMENTALLY (~15 tweets per slice, read-modify-rewrite) rather than one final write. A subagent that holds everything for the end dies on a 90s API timeout and produces no file. On partial failure, check which `judged-N.json` exist, validate them (count + id-set equality against the batch), and re-dispatch ONLY the missing batches with the incremental procedure added.
4. **Subagent failure fallback (validated 2026-09-02):** a batch can fail TWICE even with the incremental procedure — the retry died during its reading phase and never wrote anything (confirmed via `tail` of the live transcript in `~/.hermes/cache/delegation/live/<deleg_id>/task-N.log`: it read the whole batch but no write call followed). Do NOT re-dispatch a third time. Judge the failing batch YOURSELF in the main session: print the tweets in 2 passes of ~45 (`id @author | text[:220]`, newlines as ⏎), assign a category to each inline, then write the `judged-N.json` yourself and validate. Two printed passes of ~45 fit comfortably in context; reliable and fast for a single batch.
5. **Merge** all judged files into the archive: set each record's `category` field to the exact folder name (build_vault.py CATEGORY_MAP consumes it; regex = fallback for records without `category`).
6. **Verify with real reads**: total judged == total archive, id sets equal, categories within the allowed set, distribution printed per category. To quantify the improvement, re-run the OLD regex THEMES over the archive and diff against the judged categories — baseline from the 2026-09-02 backfill: 189/445 tweets (42%) reclassified; "À lire" shrank 145 → 62 (regex left keyword-less tweets unclassified), Business 15 → 43, Design 50 → 64.

## Deliverable format

- One dated markdown file in the relevant project dir (x-growth extracts go to `~/Documents/Hermes/Social Network/x-growth/`), grouped by THEME (domain axes emerging from the judgments), not by category bins — Walid wants classification "intelligemment par domaines", i.e. synthesized axes, each item keeping its X URL.
- Open it in `desktop_preview` at the end.
- State honestly which tweets point to external content (image/URL) whose text is not in the archive.

## Read List rebuilds (2026-09-02, second pass)

When the extract's purpose is a READ list (long threads, articles, guides, papers, XP write-ups), judge on **content TYPE, not category**: real reading material lives across ALL domain categories (AI & Agents, Dev, Business…), while the `À lire` category holds mostly memes/one-liners/media-less tweets. Pre-filter candidates by length (≥280 chars), thread markers, or "wrote/article/blog/guide" mentions, then judge — deterministic filtering for volume reduction is fine, the per-tweet decision is not.

Deliverable: rebuild the monthly `1. Flux/Read List/<AAAA-MM>.md` with only reading-worthy entries (title, summary, author, reading time), then mark ALL archive ids as processed in `~/.hermes/bookmarks-agent/state/readlist_state.json` so the 6h45 cron only appends future tweets. Known product/tool pages (Midea clim, gadget calendar) belong in `À checker`, never in the read list.

## Media-only tweets & X Articles (2026-09-02, "find that remembered tweet" use case)

~2 % of archive records have empty `text` (media-only). When hunting a user-remembered tweet, resolve them before concluding:

1. **Refetch via TweetDetail** (method in the scoring section above): `legacy.full_text` + `entities.urls` reveal external links hidden behind `t.co`.
2. **X Articles**: a text of just one t.co URL expanding to `x.com/i/article/<id>` is an X Article. `web_extract` returns EMPTY on those (auth wall). Working method: open `https://x.com/i/article/<id>` in the logged-in agent Chrome (`session='x-growth'`) and read `document.body.innerText` — gives title, author, date, and the full body.
3. **Workflow for "trouve-moi le tweet sur X dans l'historique"**: regex over `bookmarks_full.json` for volume reduction only → judge the hits manually (never report raw regex hits as the answer) → resolve media-only records via steps 1-2 → if the remembered tweet is genuinely absent, say so plainly and list the nearest adjacent tweets instead of guessing. Ask for a fragment/author/period before offering to dig into un-bookmarked history.

First use 2026-09-02: Walid remembered a "totally ban agents from writing tests" tweet — not in the archive; the adjacent ones were @Shreyassanthu77 (`DO NOT TEST THE BROWSER...`) and @mattpocockuk (`Tautological tests considered harmful`).

## Engagement + freshness scoring pass (2026-09-02, third pass — Walid's preference)

Walid rejected un-scored extracts ("j'aime pas tes extracts") and asked for ranking by **interest (comments/favs) + freshness**, weighting recency heavily because the AI-agent space evolves too fast for a 7-month-old tweet to count like this week's. Any future themed extract should end with this scoring pass — judgment selects the set, numbers rank it.

### Fetch real engagement (no displayed "1.2k" rounding — exact values)

1. **Capture the TweetDetail query**: with the XHR hook installed (section 4 of SKILL.md), open any tweet page, then SPA-navigate by clicking an internal `a[href*="/status/"]` link (full navigation kills the hook). Observed query: `/i/api/graphql/XMOz5h24KAZ86qKffKTLdQ/TweetDetail`. Note the hook must track BOTH `fetch` and XHR to see all graphql URLs.
2. **Fetch per tweet** in page context with captured headers, same-origin:
   `GET /i/api/graphql/XMOz5h24KAZ86qKffKTLdQ/TweetDetail?variables=<JSON>&features=<JSON>` with `variables = {focalTweetId, referrer: 'full_tweet_activity', rankingMode: 'Relevance', withCommunity: true, ...}` and the standard features blob (`include_quote_count: true`, etc.).
3. **Extract** from `data.threaded_conversation_with_injections_v2.instructions[].entries[].content.itemContent.tweet_results.result` (unwrap `__typename: 'TweetWithVisibilityResults'` via `.tweet`): `legacy.reply_count`, `legacy.retweet_count`, `legacy.favorite_count`, `legacy.bookmark_count`, `views.count`, `legacy.created_at` (format `'%a %b %d %H:%M:%S %z %Y'`).
4. **Pacing (validated): max 2 fetches per `js()` evaluation** — 3+ timed out the CDP eval (and eval-death loses any tweets already `shift()`ed from the queue). Keep the queue in-page (`window.__q`), accumulate results in `window.__eng`, export to an ABSOLUTE path at the end. After any eval timeout, recompute `wanted − collected` and redo the missing ids one per eval (all 4 recovered this way).

### Scoring formula (Walid-validated, 2026-09-02)

```
score = (replies×4 + bookmarks×3 + reposts×2 + likes) × 0.5^(age_days / 30)
```

- replies ×4 (real discussion), bookmarks ×3 (intention to keep), reposts ×2, likes ×1.
- Exponential decay, half-life 30 days — "infiniment plus important" for recent. If Walid asks for different weighting, parameters live in one place; re-score from the saved metrics JSON in one minute.
- Deliverable: tiered doc (S < 30 j / A 1-3 mois / B fondations) with per-tweet exact metrics + URL, plus an explicit "what scoring changed vs the manual selection" section (e.g. bug→test rule fell rank 1 → 27 on age; the Google skill-evolution paper jumped to #1 on 5-day recency). Filed at `~/Documents/Hermes/Social Network/x-growth/pi-harness-scored-2026-09-02.md`.
- Keep the un-scored judgment extract as the input; scoring re-orders, it does not re-select (a low-engagement gem like @ghoniemcodes stays in the doc, flagged as "keep for the meta-criterion").
