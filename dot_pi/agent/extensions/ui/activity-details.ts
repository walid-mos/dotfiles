/** A shared detail gutter; content keeps its own renderer and local mouse coordinates. */
import { ACTIVITY_DETAIL_PREFIX, renderActivityRail } from './activity-line.ts'
import {
	columnWidth,
	terminalLineWidth,
	truncateTerminalLine,
} from './terminal-text.ts'

import type {
	Component,
	TuiMouseEvent,
	TuiMouseEventResult,
} from '@earendil-works/pi-tui'

const GUTTER_COLUMNS = terminalLineWidth(ACTIVITY_DETAIL_PREFIX)

export class ActivityDetails implements Component {
	private readonly content: Component
	private readonly kind: 'text' | 'image'

	constructor(content: Component, kind: 'text' | 'image' = 'text') {
		this.content = content
		this.kind = kind
	}

	render(width: number): string[] {
		const budget = columnWidth(width)
		const prefix = renderActivityRail('detail')
		if (this.kind === 'image' && budget <= GUTTER_COLUMNS)
			return [truncateTerminalLine(prefix, budget)]
		const lines = this.content.render(Math.max(1, budget - GUTTER_COLUMNS))
		// Native image sequences carry cursor movement and payloads: never text-clip them.
		if (this.kind === 'image') return lines.map(line => prefix + line)
		return lines.map(line => truncateTerminalLine(prefix + line, budget))
	}

	invalidate(): void {
		this.content.invalidate()
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.x < GUTTER_COLUMNS) return undefined
		return this.content.handleMouse?.({
			...event,
			x: event.x - GUTTER_COLUMNS,
			width: Math.max(1, event.width - GUTTER_COLUMNS),
		})
	}
}
