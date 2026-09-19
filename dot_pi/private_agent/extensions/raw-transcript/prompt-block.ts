/** Literal submitted prompts inside the shared house frame, without Markdown interpretation. */
import { blendHex, foregroundHex } from '../ui/design-system/terminal-color.ts'
import { UI_COLOR, uiTheme } from '../ui/design-system/theme.ts'
import { blockTitle, framedBlock, frameContentWidth } from '../ui/frame.ts'
import { colorizeRailLine } from '../ui/relay-line.ts'
import { columnWidth, wrapTerminalLine } from '../ui/terminal-text.ts'

import type { Component } from '@earendil-works/pi-tui'
import type { PromptAttachment } from '../ui/prompt-attachment.ts'

const MIN_CONTENT_COLUMNS = 2
const MIN_ORNAMENT_COLUMNS = 24
const PROMPT_BORDER_STRENGTH = 0.4
const PROMPT_BORDER_INK = blendHex(
	UI_COLOR.base,
	UI_COLOR.rail,
	PROMPT_BORDER_STRENGTH,
)
const MESSAGE_GAP = ''

function promptTitle(columns: number): string {
	const title = blockTitle('Prompt')
	return columns < MIN_ORNAMENT_COLUMNS
		? title
		: `${uiTheme.fg('rail', '❯')} ${title}`
}

export class PromptBlock implements Component {
	private readonly source: string
	private attachments: PromptAttachment | undefined
	private cached: { width: number; lines: string[] } | undefined

	constructor(source: string) {
		this.source = source.replace(/\r/g, '')
	}

	attach(content: PromptAttachment): boolean {
		if (!content.matchesPrompt(this.source)) return false
		this.attachments = content
		this.invalidate()
		return true
	}

	private body(width: number): string[] {
		const text = this.source
			.split('\n')
			.flatMap(line =>
				wrapTerminalLine(
					uiTheme.fg('text', colorizeRailLine(line)),
					width,
				),
			)
		const attachments = this.attachments?.render(width) ?? []
		return attachments.length
			? [...attachments, MESSAGE_GAP, ...text]
			: text
	}

	render(width: number): string[] {
		const columns = columnWidth(width)
		if (!columns || !this.source.trim()) return []
		if (this.cached?.width === columns) return this.cached.lines
		const contentWidth = frameContentWidth(columns)
		const canFrame = contentWidth >= MIN_CONTENT_COLUMNS
		const body = this.body(canFrame ? contentWidth : columns)
		const content = canFrame
			? framedBlock({
					width: columns,
					title: promptTitle(columns),
					lines: [MESSAGE_GAP, ...body, MESSAGE_GAP],
					footer: '',
					border: stroke => foregroundHex(PROMPT_BORDER_INK, stroke),
				})
			: body
		const lines = [MESSAGE_GAP, ...content, MESSAGE_GAP]
		this.cached = { width: columns, lines }
		return lines
	}

	invalidate(): void {
		this.cached = undefined
		this.attachments?.invalidate()
	}
}
