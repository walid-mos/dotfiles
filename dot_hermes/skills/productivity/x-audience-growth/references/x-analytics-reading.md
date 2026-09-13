# Reading X Premium Analytics — validated method (2026-09)

Account context: @dev_au_bonnet, Premium+ (`Verified` badge on the dashboard). Verified against the 2026-09 dashboard UI (Chrome 152, desktop viewport 1614×1279).

## 1. The core gotcha: metric values are invisible to text extraction

`document.body.innerText` on `https://x.com/i/account_analytics` returns only:
- tab labels (Overview / Audience / Content / Video / Live / Spaces),
- period buttons (7D / 2W / 4W / 3M / 1Y),
- chart axis ticks and date labels,
- metric NAMES + trend arrows (↑/↓) — **but NOT the values** (e.g. "10K", "0.3%").

Also verified failures: `div[role="table"]` rows → empty; `[aria-label]` scan → empty; waiting 30+ s does not make values appear as text (values are rendered in a way innerText does not surface — likely canvas/exotic rendering). Don't burn calls re-probing; go straight to screenshots.

## 2. Working extraction recipe

```python
# one browser_exec call (isolated session!)
new_tab('https://x.com/i/account_analytics')
wait_for_load()
import time; time.sleep(10)          # charts need ~10-25 s to render
print(capture_screenshot())          # read values visually
```

- The first 7D screenshot usually renders completely. Give up to ~25 s total before screenshotting if tiles are missing.
- Screenshot shows: impressions chart, follows-over-time, posts/replies chart, and the metric tiles (Checkmark followers, Impressions, Engagement rate, Engagements, Profile visits, Replies, Likes, Reposts, Bookmarks, Shares) with values + period-over-period deltas.

## 3. Switching periods and tabs

Period buttons and section tabs are plain DOM elements matched by exact text:

```js
(() => {
  const tabs = [...document.querySelectorAll('button, a, [role="tab"], [role="radio"]')];
  const t = tabs.find(e => e.textContent.trim() === '4W');  // or '3M', '1Y', 'Audience', 'Content'
  if (t) { t.click(); return 'clicked'; }
  return 'not found';
})()
```

Then `time.sleep(8)` and `capture_screenshot()` again. Works for Overview periods and the section tabs. On the Audience tab the period control is `7D / 28D / 3M`.

## 4. Observed layout (for visual reading)

- **Overview**: "Account overview" header with Verified badge + period row; impressions bar chart with "Select secondary metric" dropdown and Daily/Bar toggle; "Follows over time" card (blue=+ / red=−); Posts vs Replies card; then two rows of metric tiles with green/red deltas vs previous period.
- **Audience**: Age bars (13-17 → 65+), Gender donut, Country bars with flags (top 5 + "Other"), Device donut, "Active times" heatmap (Mo–Su × hours, least→most engaged), Following card. Backed by "Likes" selector and 7D/28D/3M period row.
- **Content**: table of posts — Date | Impressions | Likes | Replies | Reposts — sortable by period; includes quote-tweets and replies; best signal is comparing impressions per format (original vs QT vs meme-with-image).

## 5. Cross-checking with the profile page

Profile (`https://x.com/<handle>`) IS fully text-extractable via `document.body.innerText`: posts count, following/followers counts, bio, pinned tweet, recent posts with timestamps. Use it to complement the dashboard (follower totals, content reading) — only the analytics dashboard needs the screenshot method.

## 6. Reference numbers captured 2026-09-01 (baseline)

- 7D: 10K impressions (+183%), 0.3% ER, 40 engagements, 16 profile visits, 15 likes, 0 bookmarks
- 4W: 15K impressions, 0.7% ER, 31 profile visits, 64 likes, 4 bookmarks
- 3M: 54.7K impressions (−15%), 1.2% ER, 122 profile visits, 451 likes, 17 bookmarks, 8 reposts
- Followers 87 (12 checkmarked), following 213, 1,420 posts total
- Audience: 77% aged 18–24, 53.8% 25–34; 86.7% male; France 40% / USA 20% / South Africa 13% / Algeria 7% / Australia 7%; device web 46.7% / iOS 33% / Android 20%; active mostly weekday afternoons–evenings CET.

(For later audits: don't trust these — re-pull. They exist here only as the format example and the historical baseline.)