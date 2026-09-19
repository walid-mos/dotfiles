// The VM's answerability as the last probe saw it, kept host-side. A starved Apple container
// VM answers nothing - not `exec`, and measured on 2026-09-18, not even `stop` - so the
// verdict is remembered instead of re-learned: every later call fails at once with the
// recovery it needs, and the best-effort post-edit touch skips rather than queueing behind a
// hang that outlasts the turn that started it. The runtime's own `running` state is never
// consulted here, because a starved VM reports exactly that.
const UNRESPONSIVE_WINDOW_MS = 300_000

const unresponsiveUntil = new Map<string, number>()

/** Was this container found starved recently enough that a probe would only repeat itself? */
export function containerRecentlyUnresponsive(
	containerName: string,
	now: number = Date.now(),
): boolean {
	return (unresponsiveUntil.get(containerName) ?? 0) > now
}

/** One failed probe covers the window: a probe of a starved VM costs 30 s of its own. */
function markContainerUnresponsive(
	containerName: string,
	now: number = Date.now(),
): void {
	unresponsiveUntil.set(containerName, now + UNRESPONSIVE_WINDOW_MS)
}

/** The verdict of one probe, as the callers of the probe see it. */
export function noteProbeVerdict(
	containerName: string,
	isAnswering: boolean,
	now: number = Date.now(),
): void {
	if (isAnswering) clearContainerUnresponsive(containerName)
	else markContainerUnresponsive(containerName, now)
}

/** A probe that answered, a restart, or a sync: whatever was known is stale. */
export function clearContainerUnresponsive(containerName: string): void {
	unresponsiveUntil.delete(containerName)
}
