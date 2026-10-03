import {
	MAX_TIMING_TOOL_ROWS,
	addTimingUsage,
	timingUsageOf,
} from './timing-records.ts'

import type { ToolResultMessage } from '@earendil-works/pi-ai'
import type { TimingToolBook, TimingToolRow } from './timing-records.ts'

type ToolRow = Omit<TimingToolRow, 'name'>
type OpenTool = { name: string; startedAtMs: number }

/** Tool wall time advances only while at least one observed call is open. */
export class TimingTools {
	private starts = new Map<string, OpenTool>()
	private rows = new Map<string, ToolRow>()
	private calls = 0
	private wallMs = 0
	private busyStartedAtMs = 0

	start(callId: string, name: string, nowMs: number): void {
		if (!this.starts.size) this.busyStartedAtMs = nowMs
		this.starts.set(callId, { name, startedAtMs: nowMs })
		this.calls += 1
		this.row(name).calls += 1
	}

	end(callId: string, nowMs: number): void {
		const started = this.starts.get(callId)
		if (!started) return
		this.starts.delete(callId)
		this.row(started.name).activeMs += Math.max(
			0,
			nowMs - started.startedAtMs,
		)
		if (!this.starts.size)
			this.wallMs += Math.max(0, nowMs - this.busyStartedAtMs)
	}

	addUsages(toolResults: readonly ToolResultMessage[]): void {
		for (const toolResult of toolResults) {
			if (!toolResult.usage) continue
			const row = this.row(toolResult.toolName)
			row.usage = addTimingUsage(
				row.usage,
				timingUsageOf(toolResult.usage),
			)
		}
	}

	snapshot(nowMs: number): TimingToolBook {
		const openWallMs = this.starts.size
			? Math.max(0, nowMs - this.busyStartedAtMs)
			: 0
		return {
			wallMs: this.wallMs + openWallMs,
			calls: this.calls,
			toolRowsOmitted: Math.max(0, this.rows.size - MAX_TIMING_TOOL_ROWS),
			rows: [...this.rows]
				.slice(0, MAX_TIMING_TOOL_ROWS)
				.map(([name, { calls, activeMs, usage }]) => {
					const toolRow: TimingToolRow = { name, calls, activeMs }
					if (usage) toolRow.usage = usage
					return toolRow
				}),
		}
	}

	private row(name: string): ToolRow {
		const existing = this.rows.get(name)
		if (existing) return existing
		const created = { calls: 0, activeMs: 0 }
		this.rows.set(name, created)
		return created
	}
}
