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

	constructor(content: Component) {
		this.content = content
	}

	render(width: number): string[] {
		const budget = columnWidth(width)
		const prefix = renderActivityRail('detail')
		const lines = this.content.render(Math.max(1, budget - GUTTER_COLUMNS))
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
