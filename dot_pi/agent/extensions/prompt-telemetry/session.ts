/**
 * Owner of the telemetry line's lifetime, one instance per extension load.
 *
 * It holds the tracked prompt, the editor repaint handle and the single timer
 * that retires the frozen line. Time is read when the line renders, so pi's own
 * render loop animates it; the class only decides which prompt state is shown.
 */

import { renderTelemetryLine } from './render.ts'
import {
	idleTelemetry,
	recordAssistantUsage,
	recordStreamDelta,
	settleTelemetry,
	startTelemetry,
	startTurn,
	stopTelemetry,
} from './state.ts'

import type { Theme } from '@earendil-works/pi-coding-agent'
import type { PromptTelemetry, StreamDelta, TurnUsage } from './state.ts'

/** How long the frozen line stays readable after the agent settles. */
const DEFAULT_LINGER_MS = 20_000

/** Timing knobs; tests shrink the linger instead of waiting twenty seconds. */
export type TelemetrySessionOptions = {
	lingerMs?: number
}

export class TelemetrySession {
	private telemetry: PromptTelemetry = idleTelemetry()
	private readTheme: (() => Theme) | undefined
	private repaint: () => void = noop
	private lingerTimer: ReturnType<typeof setTimeout> | undefined
	private readonly lingerMs: number

	constructor(options: TelemetrySessionOptions = {}) {
		this.lingerMs = options.lingerMs ?? DEFAULT_LINGER_MS
	}

	/** Handed to the editor hook: pi's TUI, for repainting the line. */
	bindRepaint(repaint: () => void): void {
		this.repaint = repaint
	}

	/** Editor hook: the line for this width, or nothing while inactive. */
	renderLine(width: number): string | undefined {
		const theme = this.readTheme?.()
		if (!this.telemetry.active || !theme) return undefined
		return renderTelemetryLine(this.telemetry, Date.now(), width, theme)
	}

	/** New session: no prompt is being served yet. Theme is read live. */
	start(readTheme: () => Theme): void {
		this.readTheme = readTheme
		this.clearLinger()
		this.telemetry = idleTelemetry()
		this.repaint()
	}

	/** New prompt: it owns the line; a frozen predecessor is retired now. */
	startPrompt(): void {
		this.clearLinger()
		this.telemetry = startTelemetry(Date.now())
		this.repaint()
	}

	startTurn(): void {
		this.telemetry = startTurn(this.telemetry, Date.now())
	}

	recordDelta(event: StreamDelta): void {
		this.telemetry = recordStreamDelta(this.telemetry, event, Date.now())
	}

	recordUsage(message: TurnUsage): void {
		this.telemetry = recordAssistantUsage(
			this.telemetry,
			message,
			Date.now(),
		)
	}

	/** Agent settled: freeze the line, then retire it after the linger. */
	settle(): void {
		if (!this.telemetry.active) return
		this.telemetry = settleTelemetry(this.telemetry, Date.now())
		this.repaint()
		this.clearLinger()
		const timer = setTimeout(() => {
			this.telemetry = stopTelemetry()
			this.repaint()
		}, this.lingerMs)
		timer.unref()
		this.lingerTimer = timer
	}

	stop(): void {
		this.clearLinger()
		this.telemetry = idleTelemetry()
		this.repaint()
		this.readTheme = undefined
	}

	private clearLinger(): void {
		if (this.lingerTimer) clearTimeout(this.lingerTimer)
		this.lingerTimer = undefined
	}
}

const noop = (): void => {}
