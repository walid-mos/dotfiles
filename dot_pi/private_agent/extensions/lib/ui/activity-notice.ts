/** Unboxed response notices: bold semantic ink distinguishes them from tool rows. */
import { activityNoticeLead } from './activity-line.ts'
import { uiTheme } from './design-system/theme.ts'
import { columnWidth, pushWrapped } from './terminal-text.ts'

import type { Component } from '@earendil-works/pi-tui'

const NOTICE_MARKERS = { danger: '✕', warning: '!' } as const

export class ActivityNotice implements Component {
	private readonly text: string
	private readonly tone: keyof typeof NOTICE_MARKERS

	constructor(text: string, tone: keyof typeof NOTICE_MARKERS) {
		this.text = text
		this.tone = tone
	}

	render(width: number): string[] {
		const columns = columnWidth(width)
		if (!columns) return ['']
		const marker = uiTheme.bold(
			uiTheme.fg(this.tone, NOTICE_MARKERS[this.tone]),
		)
		const lines: string[] = []
		pushWrapped(
			line => lines.push(line),
			activityNoticeLead(columns, marker),
			uiTheme.bold(uiTheme.fg(this.tone, this.text)),
			columns,
		)
		return lines
	}

	invalidate(): void {
		// Immutable text; wrapping follows the current viewport on each render.
	}
}
