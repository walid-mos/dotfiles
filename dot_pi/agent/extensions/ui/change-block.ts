/** Numbered diff content shared by both views of a mutation panel. */
import { uiTheme } from './design-system/theme.ts'
import {
	columnWidth,
	terminalLineWidth,
	truncateTerminalLine,
	wrapTerminalLine,
} from './terminal-text.ts'

import type { Component } from '@earendil-works/pi-tui'

export interface ChangeLine {
	kind: 'added' | 'removed' | 'context' | 'gap' | 'written'
	text: string
	lineNumber?: number
}

export interface ChangeDocument {
	lines: readonly ChangeLine[]
	note: string
}

type ChangeView = 'preview' | 'expanded'
const PREVIEW_ROWS = 8
const MIN_CODE_COLUMNS = 4
const NUMBER_COLUMNS = 3
const GUTTER_CHROME_COLUMNS = 5
const TAB_SPACES = '    '
const CONTROL_HEX_WIDTH = 2
const HEX_RADIX = 16
const LINE_STYLE = {
	added: { marker: '+', tone: 'success', background: 'diffAddedBg' },
	removed: { marker: '-', tone: 'danger', background: 'diffRemovedBg' },
	context: { marker: ' ', tone: 'dim', background: '' },
	written: { marker: ' ', tone: 'dim', background: '' },
	gap: { marker: ' ', tone: 'dim', background: '' },
} as const

function codeText(source: string): string {
	return source
		.replace(/\t/gu, TAB_SPACES)
		.replace(
			/\p{Cc}/gu,
			character =>
				`\\x${character.charCodeAt(0).toString(HEX_RADIX).padStart(CONTROL_HEX_WIDTH, '0')}`,
		)
}

export class ChangeBlock implements Component {
	private readonly document: ChangeDocument
	private readonly numberColumns: number
	private readonly added: number
	private readonly removed: number
	private view: ChangeView = 'preview'
	private cached:
		| { width: number; view: ChangeView; lines: string[] }
		| undefined

	constructor(document: ChangeDocument) {
		this.document = document
		this.numberColumns = document.lines.reduce(
			(columns, line) =>
				Math.max(columns, String(line.lineNumber ?? '').length),
			NUMBER_COLUMNS,
		)
		this.added = document.lines.filter(line => line.kind === 'added').length
		this.removed = document.lines.filter(
			line => line.kind === 'removed',
		).length
	}

	setView(view: ChangeView): void {
		this.view = view
	}

	render(width: number): string[] {
		const columns = columnWidth(width)
		if (!columns) return []
		if (this.cached?.width === columns && this.cached.view === this.view)
			return this.cached.lines
		const lines = this.previewRows(columns)
		this.cached = { width: columns, view: this.view, lines }
		return lines
	}

	invalidate(): void {
		this.cached = undefined
	}

	private previewRows(width: number): string[] {
		if (width < MIN_CODE_COLUMNS + GUTTER_CHROME_COLUMNS) return []
		if (!this.document.lines.length)
			return [uiTheme.fg('dim', 'No code lines to show.')]
		const rows: string[] = []
		for (const line of this.document.lines) {
			rows.push(...this.codeRows(line, width))
			if (this.view === 'preview' && rows.length > PREVIEW_ROWS) break
		}
		return this.view === 'preview' ? rows.slice(0, PREVIEW_ROWS) : rows
	}

	private codeRows(line: ChangeLine, width: number): string[] {
		const numbers = Math.min(
			this.numberColumns,
			Math.max(0, width - GUTTER_CHROME_COLUMNS - MIN_CODE_COLUMNS),
		)
		const codeWidth = width - numbers - GUTTER_CHROME_COLUMNS
		const text = line.kind === 'gap' ? '⋯' : codeText(line.text)
		return wrapTerminalLine(text, codeWidth).map((part, index) => {
			const { marker, tone, background } = LINE_STYLE[line.kind]
			const sign = index ? ' ' : marker
			const number =
				index === 0 && line.lineNumber ? String(line.lineNumber) : ''
			const gutter = `${uiTheme.fg(tone, sign)} ${uiTheme.fg('dim', truncateTerminalLine(number, numbers, '…').padStart(numbers))}${uiTheme.fg('border', ' │ ')}`
			const body = uiTheme.fg(line.kind === 'gap' ? 'dim' : 'text', part)
			const row =
				gutter +
				body +
				' '.repeat(Math.max(0, codeWidth - terminalLineWidth(part)))
			if (background) return uiTheme.bg(background, row)
			return row
		})
	}

	renderFooter(): string {
		const stats =
			[
				this.added
					? uiTheme.fg('success', `+${String(this.added)}`)
					: '',
				this.removed
					? uiTheme.fg('danger', `-${String(this.removed)}`)
					: '',
			]
				.filter(Boolean)
				.join(' ') ||
			uiTheme.fg('dim', `${String(this.document.lines.length)}l shown`)
		const action = this.view === 'preview' ? 'expand' : 'fold'
		return [stats, this.document.note, `click / Ctrl+O to ${action}`]
			.filter(Boolean)
			.map((part, index) => (index ? uiTheme.fg('dim', part) : part))
			.join(uiTheme.fg('dim', ' · '))
	}
}
