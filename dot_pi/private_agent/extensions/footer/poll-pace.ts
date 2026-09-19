// Quota and GitHub poll cadence plus the on-demand refresh points. Polling is
// decorative: slow enough to stay invisible, fast enough for the footer to feel live.

/** Quota strips are slow-moving billing windows: refresh every five minutes. */
const QUOTA_POLL_MINUTES = 5
const SECONDS_PER_MINUTE = 60
const MS_PER_SECOND = 1000
export const QUOTA_POLL_MS =
	QUOTA_POLL_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND

/** GitHub PR lookup cadence (gh CLI is cold). */
export const PR_POLL_MS = 30_000

/** Live Galley review desk lookup (one git toplevel + desk.lock reads). */
export const GALLEY_POLL_MS = 30_000
