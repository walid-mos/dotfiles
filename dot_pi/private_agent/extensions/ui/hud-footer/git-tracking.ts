/** Live Git snapshots: serialized local reads, coalesced nudges and abortable lifetime. */
import { fetchGitStatus } from './git-data.ts'
import { GIT_POLL_MS } from './poll-pace.ts'
import { footerState, requestRenderSafely } from './state.ts'

class GitTracker {
	private readonly controller = new AbortController()
	private timer: ReturnType<typeof setTimeout> | undefined
	private isReading = false
	private isRefreshQueued = false

	constructor(
		readonly cwd: string,
		private readonly onBranchChange: () => void,
	) {}

	async refresh(): Promise<void> {
		if (this.controller.signal.aborted) return
		if (this.isReading) {
			this.isRefreshQueued = true
			return
		}
		clearTimeout(this.timer)
		this.isReading = true
		this.isRefreshQueued = false
		const status = await fetchGitStatus(this.cwd, this.controller.signal)
		if (this.controller.signal.aborted) return
		this.isReading = false
		const previous = footerState.gitCache
		if (JSON.stringify(previous) !== JSON.stringify(status)) {
			footerState.gitCache = status
			if (previous?.branch !== status?.branch) this.onBranchChange()
			requestRenderSafely()
		}
		if (this.isRefreshQueued) {
			void this.refresh()
			return
		}
		this.timer = setTimeout(() => void this.refresh(), GIT_POLL_MS)
		this.timer.unref()
	}

	stop(): void {
		clearTimeout(this.timer)
		this.controller.abort()
	}
}

let tracking: GitTracker | undefined

/** Also catches ! commands and edits from other terminals, without intercepting shell execution. */
export function startGitTracking(
	cwd: string,
	onBranchChange: () => void,
): void {
	if (tracking?.cwd === cwd) return
	stopGitTracking()
	footerState.gitCwd = cwd
	tracking = new GitTracker(cwd, onBranchChange)
	void tracking.refresh()
}

export function refreshGit(): void {
	if (tracking) void tracking.refresh()
}

/** Late reads cannot publish after disable, disposal, reload or cwd replacement. */
export function stopGitTracking(): void {
	tracking?.stop()
	tracking = undefined
	footerState.gitCache = null
	footerState.gitCwd = null
}
