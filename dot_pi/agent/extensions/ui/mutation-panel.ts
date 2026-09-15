/** A standalone file-action panel, distinct from the observation-tool rail. */
import { renderActivityStatus } from './activity-line.ts'
import { formatActivityDuration } from './activity-timing.ts'
import { uiTheme } from './design-system/theme.ts'
import { frameContentWidth, framedBlock } from './frame.ts'
import {
	columnWidth,
	terminalLineWidth,
	truncateTerminalLine,
	wrapTerminalLine,
} from './terminal-text.ts'

import type {
	Component,
	TuiMouseEvent,
	TuiMouseEventResult,
} from '@earendil-works/pi-tui'
import type { ActivityLine } from './activity-line.ts'

const PHASE_LABELS = {
	queued: 'Preparing',
	running: 'Applying',
	success: 'Applied',
	error: 'Failed',
	cancelled: 'Cancelled',
} as const
const CONTENT_INSET = 2
const BODY_START_ROW = 2
const NOTICE_ROWS = 3
const FIELD_GAP = '  '

export class MutationPanel implements Component {
	private readonly view: () => ActivityLine
	private readonly content: Component
	private readonly footer: string
	private readonly now: () => number
	private bodyHeight = 0

	constructor(
		view: () => ActivityLine,
		content: Component,
		footer: string,
		now: () => number = Date.now,
	) {
		this.view = view
		this.content = content
		this.footer = footer
		this.now = now
	}

	render(width: number): string[] {
		const columns = columnWidth(width)
		if (!columns) return []
		const view = this.view()
		const inner = frameContentWidth(columns)
		const body = this.content.render(Math.max(1, inner))
		this.bodyHeight = body.length
		const lines = body.length ? body : this.notice(view, inner)
		const title = [
			uiTheme.bold(uiTheme.fg('accent', view.label.toUpperCase())),
			view.subject ? uiTheme.bold(uiTheme.fg('text', view.subject)) : '',
		]
			.filter(Boolean)
			.join(uiTheme.fg('dim', ' · '))
		return framedBlock({
			width: columns,
			title,
			lines: [this.metadata(view, inner), ...lines],
			footer: uiTheme.fg('dim', this.footer),
			corners: 'square',
			border: stroke => uiTheme.fg('mutationBorder', stroke),
		})
	}

	invalidate(): void {
		this.content.invalidate()
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const y = event.y - BODY_START_ROW
		if (event.x < CONTENT_INSET || y < 0 || y >= this.bodyHeight)
			return undefined
		return this.content.handleMouse?.({
			...event,
			x: event.x - CONTENT_INSET,
			y,
			width: frameContentWidth(event.width),
			height: this.bodyHeight,
		})
	}

	private metadata(view: ActivityLine, width: number): string {
		const status = `${renderActivityStatus(view.phase, this.now())} ${uiTheme.fg('muted', PHASE_LABELS[view.phase])}`
		const duration = formatActivityDuration(view.elapsedMs)
		const right = [status, duration ? uiTheme.fg('dim', duration) : '']
			.filter(Boolean)
			.join(uiTheme.fg('dim', ' · '))
		const clippedRight = truncateTerminalLine(right, width, '…')
		const leftWidth = Math.max(
			0,
			width - terminalLineWidth(clippedRight) - FIELD_GAP.length,
		)
		const left = truncateTerminalLine(
			[
				view.warning ? uiTheme.fg('warning', view.warning) : '',
				view.annotation ? uiTheme.fg('dim', view.annotation) : '',
			]
				.filter(Boolean)
				.join(uiTheme.fg('dim', ' · ')),
			leftWidth,
			'…',
		)
		const gap = ' '.repeat(
			Math.max(0, width - terminalLineWidth(left + clippedRight)),
		)
		return left + gap + clippedRight
	}

	private notice(view: ActivityLine, width: number): string[] {
		if (view.phase === 'error')
			return wrapTerminalLine(
				uiTheme.fg('danger', view.summary),
				width,
			).slice(0, NOTICE_ROWS)
		const message =
			view.phase === 'success'
				? 'Expand to inspect the full tool result.'
				: 'Waiting for an applied change.'
		if (view.phase === 'cancelled')
			return [uiTheme.fg('warning', 'Change cancelled.')]
		return [truncateTerminalLine(uiTheme.fg('dim', message), width, '…')]
	}
}
