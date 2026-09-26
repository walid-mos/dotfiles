/** A standalone full-width tool panel: file mutations and image captures share one frame. */
import {
	ACTIVITY_CONTENT_COLUMN,
	renderActivityStatus,
} from './activity-line.ts'
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
import type { FrameInsets } from './frame.ts'

const PHASE_LABELS = {
	action: {
		queued: 'Preparing',
		running: 'Applying',
		success: 'Applied',
		error: 'Failed',
		cancelled: 'Cancelled',
	},
	capture: {
		queued: 'Queued',
		running: 'Capturing',
		success: 'Captured',
		error: 'Failed',
		cancelled: 'Cancelled',
	},
} as const
const CONTENT_NOTICES = {
	action: {
		cancelled: 'Change cancelled.',
		pending: 'Waiting for an applied change.',
	},
	capture: {
		cancelled: 'Capture cancelled.',
		pending: 'Waiting for the capture.',
	},
} as const
const NOTICE_ROWS = 3
const FIELD_GAP = '  '
const BODY_START_ROW = 2
/** The top edge spends a corner and one stroke before its own inset. */
const EDGE_STROKE_COLUMNS = 2
/** Panel text starts on the activity content column, so both surfaces align. */
const INSETS: FrameInsets = {
	row: ACTIVITY_CONTENT_COLUMN - 1,
	title: ACTIVITY_CONTENT_COLUMN - EDGE_STROKE_COLUMNS,
	right: 1,
}

export type ToolPanelKind = keyof typeof PHASE_LABELS

interface ToolPanelOptions {
	kind?: ToolPanelKind
	now?: () => number
	/** Pre-rendered unclipable payload lines (terminal images), drawn above the body. */
	raw?: (width: number) => string[]
}

export class ToolPanel implements Component {
	private readonly view: () => ActivityLine
	private readonly content: Component
	private readonly footer: string
	private readonly now: () => number
	private readonly kind: ToolPanelKind
	private readonly raw: ((width: number) => string[]) | undefined
	private rawHeight = 0
	private bodyHeight = 0

	constructor(
		view: () => ActivityLine,
		content: Component,
		footer: string,
		options: ToolPanelOptions = {},
	) {
		this.view = view
		this.content = content
		this.footer = footer
		this.now = options.now ?? Date.now
		this.kind = options.kind ?? 'action'
		this.raw = options.raw
	}

	render(width: number): string[] {
		const columns = columnWidth(width)
		if (!columns) return []
		const view = this.view()
		const inner = frameContentWidth(columns, INSETS)
		const raw = this.raw?.(inner) ?? []
		this.rawHeight = raw.length
		const body = this.content.render(Math.max(1, inner))
		this.bodyHeight = body.length
		const lines =
			body.length || raw.length ? body : this.notice(view, inner)
		const title = [
			uiTheme.bold(uiTheme.fg('accent', view.label.toUpperCase())),
			view.subject ? uiTheme.bold(uiTheme.fg('text', view.subject)) : '',
		]
			.filter(Boolean)
			.join(uiTheme.fg('dim', ' · '))
		return framedBlock({
			width: columns,
			title,
			lines: [
				this.metadata(view, inner),
				...raw.map(line => ({ raw: line })),
				...lines,
			],
			footer: uiTheme.fg('dim', this.footer),
			insets: INSETS,
			corners: 'square',
			border: stroke => uiTheme.fg('mutationBorder', stroke),
		})
	}

	invalidate(): void {
		this.content.invalidate()
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const y = event.y - BODY_START_ROW - this.rawHeight
		if (event.x < ACTIVITY_CONTENT_COLUMN || y < 0 || y >= this.bodyHeight)
			return undefined
		return this.content.handleMouse?.({
			...event,
			x: event.x - ACTIVITY_CONTENT_COLUMN,
			y,
			width: frameContentWidth(event.width, INSETS),
			height: this.bodyHeight,
		})
	}

	private metadata(view: ActivityLine, width: number): string {
		const status = `${renderActivityStatus(view.phase, this.now())} ${uiTheme.fg('muted', PHASE_LABELS[this.kind][view.phase])}`
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
		const notices = CONTENT_NOTICES[this.kind]
		if (view.phase === 'error')
			return wrapTerminalLine(
				uiTheme.fg('danger', view.summary),
				width,
			).slice(0, NOTICE_ROWS)
		if (view.phase === 'cancelled')
			return [uiTheme.fg('warning', notices.cancelled)]
		const message =
			view.phase === 'success'
				? 'Expand to inspect the full tool result.'
				: notices.pending
		return [truncateTerminalLine(uiTheme.fg('dim', message), width, '…')]
	}
}
