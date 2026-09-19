/** One lazy repaint pulse for every live activity. No timer survives the last row or session shutdown. */
export const ACTIVITY_PULSE_MS = 120

type SchedulePulse = (tick: () => void) => () => void

function schedulePulse(tick: () => void): () => void {
	const timer = setInterval(tick, ACTIVITY_PULSE_MS)
	timer.unref()
	return () => clearInterval(timer)
}

export class ActivityClock {
	private readonly listeners = new Map<object, () => void>()
	private cancelPulse: (() => void) | undefined
	private isDisposed = false

	readonly now: () => number
	private readonly schedule: SchedulePulse

	constructor(
		now: () => number = Date.now,
		schedule: SchedulePulse = schedulePulse,
	) {
		this.now = now
		this.schedule = schedule
	}

	watch(owner: object, repaint: () => void): void {
		if (this.isDisposed) return
		this.listeners.set(owner, repaint)
		this.cancelPulse ??= this.schedule(() => {
			for (const render of new Set(this.listeners.values())) render()
		})
	}

	release(owner: object): void {
		this.listeners.delete(owner)
		if (this.listeners.size) return
		this.cancelPulse?.()
		this.cancelPulse = undefined
	}

	dispose(): void {
		this.isDisposed = true
		this.listeners.clear()
		this.cancelPulse?.()
		this.cancelPulse = undefined
	}
}
