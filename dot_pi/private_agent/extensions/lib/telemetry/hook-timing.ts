/** Measured custom hooks shared across jiti's separate extension registries. */
export type HookTimingReport = {
	startedAtMs: number
	endedAtMs: number
	event: string
	name: string
}

type HookTimings = {
	reports: HookTimingReport[]
	dropped: number
	count: number
	durationMs: number
}

const TIMING_BUFFER_KEY = Symbol.for('pi.telemetry-hook-timing.v2')
const MAX_PENDING_REPORTS = 64

function hookTimings(): HookTimings {
	const saved: HookTimings | undefined = Reflect.get(
		globalThis,
		TIMING_BUFFER_KEY,
	)
	if (saved) return saved
	const created = { reports: [], dropped: 0, count: 0, durationMs: 0 }
	Reflect.set(globalThis, TIMING_BUFFER_KEY, created)
	return created
}

function reportHookTiming(report: HookTimingReport): void {
	const pending = hookTimings()
	pending.count += 1
	pending.durationMs += Math.max(0, report.endedAtMs - report.startedAtMs)
	if (pending.reports.length >= MAX_PENDING_REPORTS) {
		pending.reports.shift()
		pending.dropped += 1
	}
	pending.reports.push(report)
}

/** Return the hook's own result; failed hooks still report their measured span. */
export async function runTimedHook<T>(
	event: string,
	name: string,
	body: () => T | Promise<T>,
): Promise<T> {
	const startedAtMs = Date.now()
	try {
		return await body()
	} finally {
		reportHookTiming({ startedAtMs, endedAtMs: Date.now(), event, name })
	}
}

export function drainHookTimings(): HookTimings {
	const pending = hookTimings()
	const drained = { ...pending }
	pending.reports = []
	pending.dropped = 0
	pending.count = 0
	pending.durationMs = 0
	return drained
}
