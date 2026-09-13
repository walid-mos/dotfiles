---
name: x-audience-growth
description: Use for X/Twitter analytics audits and audience-growth.
version: 1.0.0
author: Hermes Curator
license: MIT
metadata:
  hermes:
    tags: [x, twitter, analytics, audience, growth]
    related_skills: [x-bookmark-curation]
---

## When to Use

Use for any task about growing or reviewing the user's X/Twitter presence: pulling account analytics, auditing what content performs, defining positioning, drafting content calendars or reply systems, and measuring progress against a follower baseline. For bookmark curation and vault sync, use `x-bookmark-curation` instead.

## Session-specific detail

- [`references/x-analytics-reading.md`](references/x-analytics-reading.md) — validated method for extracting values from the Premium analytics dashboard (2026 UI), period-tab switching, and observed audience-tab layout.
- Current account state, positioning decision, and baseline snapshot live in the user's `Social Network` project: `~/Documents/Hermes/Social Network/x-growth/audit-and-plan-2026-09-01.md`. Read it before re-auditing; append new snapshots rather than overwriting history.

## 1. Infrastructure and session hygiene

- The authenticated X session lives in the dedicated agent Chrome (CDP `http://127.0.0.1:9223`, LaunchAgent `com.walid.chrome-agent`). Health check: `curl -s http://127.0.0.1:9223/json/version`. See `x-bookmark-curation` section 7 for repair recipes.
- **Pitfall (verified 2026-09): the DEFAULT `browser_exec` session is shared with cron jobs.** Mid-task, a scheduled run (e.g. freelance-presence) navigated the shared tab to another site and destroyed the audit page state. For any interactive X work, always pass an isolated named session: `browser_exec(..., session='x-growth')`, and reuse the same name across calls. Do not use the default session for multi-step browsing.

## 2. Reading analytics (verified method)

The Premium analytics dashboard (`https://x.com/i/account_analytics`) does NOT expose metric values via `innerText` or role-table queries — only labels, axis ticks, and arrows render as text. The working method is: navigate, wait ~10–25 s for charts, then `capture_screenshot()` and read values visually with vision. Full recipe and tab-switching JS: [`references/x-analytics-reading.md`](references/x-analytics-reading.md).

Key metrics to capture per period (7D/4W/3M/1Y): impressions, engagement rate, engagements, profile visits, replies, likes, reposts, bookmarks, shares, checkmark followers. The **Audience** tab gives age/gender/country/device/active-times — essential for positioning decisions.

## 3. Audit framework

1. **Baseline numbers** — overview metrics at several periods, plus follower/following/post counts from the profile page.
2. **Audience shape** — from the Audience tab: who already watches (age, geo, device, active hours). Growth strategy must align with it (e.g. 60% non-France audience justifies an English pivot; desktop-heavy = dev audience).
3. **Content pattern** — Content tab sorted by period; classify recent posts (quote-tweets, replies, originals, memes, threads) and note which format carries engagement. Record best-performing posts with their numbers.
4. **Diagnosis** — typical patterns: renting attention via quote-tweets without original artifacts; no positioning in bio; volume without a content-type strategy.
5. **Plan** — positioning statement, profile rewrite (name/bio/pinned post), weekly content rotation, daily reply quota, posting windows matched to the audience heatmap, realistic milestones. Distinguish honest trajectories (100K = multi-year, compounding assets) from weekly tactics.

## 4. Measuring progress

- Compare against the saved baseline snapshot; never restate numbers from memory — re-pull from the dashboard.
- Leading indicator at small follower counts: profile visits and reply impressions, not follower count.
- Save each audit as a dated file under the project's `x-growth/` directory; keep the oldest snapshot as the historical baseline.

## 5. Safety

- Analytics and profile reads are safe; never post, like, repost, edit profile, or send DMs unless the user explicitly approves each action in the conversation.
- Drafts for bio/posts are proposals until the user approves; publish only after approval, then verify the live page.
- Never print credentials, bearer tokens, or CSRF values (same rule as `x-bookmark-curation`).