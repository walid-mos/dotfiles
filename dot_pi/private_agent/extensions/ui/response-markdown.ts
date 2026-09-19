/** Response typography over Pi's Markdown engine, with bounded wrapping and no boxed background. */
import { Markdown } from '@earendil-works/pi-tui'

import { uiTheme } from './design-system/theme.ts'
import { colorizeRailLine } from './relay-line.ts'
import {
	columnWidth,
	terminalLineWidth,
	wrapTerminalLine,
} from './terminal-text.ts'

import type {
	Component,
	MarkdownOptions,
	MarkdownTheme,
} from '@earendil-works/pi-tui'

interface ResponseMarkdownOptions extends MarkdownOptions {
	inset: number
	tone: 'text' | 'muted'
}

const SIDES = 2

function responseTheme(base: MarkdownTheme): MarkdownTheme {
	return {
		...base,
		heading: text => uiTheme.fg('accent', text),
		bold: text => uiTheme.bold(text),
		link: text => uiTheme.fg('rail', text),
		linkUrl: text => uiTheme.fg('dim', text),
		code: text => uiTheme.fg('accent', text),
		codeBlock: text => uiTheme.fg('output', text),
		codeBlockBorder: text => uiTheme.fg('dim', text),
		quote: text => uiTheme.fg('muted', text),
		quoteBorder: text => uiTheme.fg('dim', text),
		hr: text => uiTheme.fg('dim', text),
		listBullet: text => uiTheme.fg('accent', text),
	}
}

export class ResponseMarkdown implements Component {
	private readonly markdown: Markdown
	private readonly inset: number
	private cached: { width: number; lines: string[] } | undefined

	constructor(
		source: string,
		theme: MarkdownTheme,
		options: ResponseMarkdownOptions,
	) {
		const { inset, tone, ...markdownOptions } = options
		this.inset = columnWidth(inset)
		this.markdown = new Markdown(
			source,
			0,
			0,
			responseTheme(theme),
			{
				color: text => uiTheme.fg(tone, colorizeRailLine(text)),
			},
			markdownOptions,
		)
	}

	render(width: number): string[] {
		const columns = columnWidth(width)
		if (!columns) return []
		if (this.cached?.width === columns) return this.cached.lines
		const inset = Math.min(this.inset, Math.floor((columns - 1) / SIDES))
		const contentWidth = columns - inset * SIDES
		const margin = ' '.repeat(inset)
		const lines = this.markdown.render(contentWidth).flatMap(line => {
			const wrapped =
				terminalLineWidth(line) > contentWidth
					? wrapTerminalLine(line, contentWidth)
					: [line]
			return wrapped.map(row => margin + row)
		})
		this.cached = { width: columns, lines }
		return lines
	}

	invalidate(): void {
		this.cached = undefined
		this.markdown.invalidate()
	}
}
