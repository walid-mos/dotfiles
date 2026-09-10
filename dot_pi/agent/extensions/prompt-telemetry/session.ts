/**
 * Owner of the activity block's lifetime, one instance per extension load.
 *
 * It holds the tracked prompt and the editor repaint handle - no timer at all:
 * a frozen block stays on screen until the next prompt takes the line over, and
 * time is read when the block renders, so pi's own render loop animates it.
 */

import { renderTelemetryBlock } from './render.ts'
import {
	idleTelemetry,
	recordAssistantUsage,
	recordStreamDelta,
	settleTelemetry,
	startTelemetry,
	startTurn,
} from './state.ts'

import type { ActivityPaint } from './render.ts'
import type { PromptTelemetry, StreamDelta, TurnUsage } from './state.ts'

export class TelemetrySession {
	private telemetry: PromptTelemetry = idleTelemetry()
	private repaint: () => void = noop

	/** Handed to the editor hook: pi's TUI, for repainting the line. */
	bindRepaint(repaint: () => void): void {
		this.repaint = repaint
	}

	/** Editor hook: the block for this width budget, or nothing while inactive. */
	renderActivity(maxWidth: number, paint: ActivityPaint): string | undefined {
		if (!this.telemetry.active) return undefined
		return renderTelemetryBlock(this.telemetry, Date.now(), maxWidth, paint)
	}

	/** New session: no prompt is being served yet. */
	start(): void {
		this.telemetry = idleTelemetry()
		this.repaint()
	}

	/** New prompt: it owns the line, replacing whatever the last one left. */
	startPrompt(): void {
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

	/** Agent settled: freeze the line. It stays until the next prompt. */
	settle(): void {
		if (!this.telemetry.active) return
		this.telemetry = settleTelemetry(this.telemetry, Date.now())
		this.repaint()
	}

	stop(): void {
		this.telemetry = idleTelemetry()
		this.repaint()
	}
}

const noop = (): void => {}
