// Quota and GitHub poll cadence plus the on-demand refresh points. Polling is
// decorative: slow enough to stay invisible, fast enough for the footer to feel live.

/** Quota strips are slow-moving billing windows: refresh every five minutes. */
const QUOTA_POLL_MINUTES = 5
const SECONDS_PER_MINUTE = 60
const MS_PER_SECOND = 1000
export const QUOTA_POLL_MS =
	QUOTA_POLL_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND

/** Local Git refresh delay after each completed snapshot; no overlapping reads. */
export const GIT_POLL_MS = 1500

/** GitHub PR lookup cadence (gh CLI is cold). */
export const PR_POLL_MS = 30_000

/** Live Syneva desk lookup for this Pi session's attachment. */
export const REVIEW_POLL_MS = 30_000
