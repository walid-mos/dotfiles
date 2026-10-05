/** Shared presentation kit for transcript message cards (the house cards
 * that replace pi's default `[customType]` box): panel geometry on the
 * activity content column, the settled activity glyphs on the title edge,
 * the frame ink blended toward the status role, the verbatim minted body
 * capped to a collapsed preview that global Ctrl+O reveals, and the two
 * message-content helpers shared by every message card parser. Cards show
 * settled facts: no animation, no clock - a `running` spinner never fits a
 * pasted notice. */
import { ACTIVITY_CONTENT_COLUMN } from './activity-line.ts'
import { blendHex, foregroundHex } from './design-system/terminal-color.ts'
import { UI_COLOR, uiTheme } from './design-system/theme.ts'
import { blockTitle, framedBlock, frameContentWidth } from './frame.ts'
import { wrapTerminalLine } from './terminal-text.ts'

import type { Component } from '@earendil-works/pi-tui'
import type { FrameInsets } from './frame.ts'

/** The top edge spends a corner and one stroke before its own inset. */
const EDGE_STROKE_COLUMNS = 2
/** Panel text starts on the activity content column, so both surfaces align. */
export const CARD_INSETS: FrameInsets = {
	row: ACTIVITY_CONTENT_COLUMN - 1,
	title: ACTIVITY_CONTENT_COLUMN - EDGE_STROKE_COLUMNS,
	right: 1,
}
/** Frame ink blends base toward the status tone at the mutation-panel mix. */
export const CARD_BORDER_STRENGTH = 0.6

/** One tone decides glyph ink and border blend together. */
export type CardTone = 'accent' | 'success' | 'warning' | 'danger' | 'dim'

export type CardCuePhase = 'queued' | 'success' | 'error' | 'cancelled'
export type CardCue = CardCuePhase | 'attention'

/** The activity glyphs, pushed through their own palette roles. */
const PHASE_CUE: Record<
	CardCuePhase,
	{ glyph: string; tone: Exclude<CardTone, 'accent'> }
> = {
	queued: { glyph: '◌', tone: 'dim' },
	success: { glyph: '✓', tone: 'success' },
	error: { glyph: '✕', tone: 'danger' },
	cancelled: { glyph: '⊘', tone: 'warning' },
}

/** Body rows kept while collapsed; global Ctrl+O reveals them all. */
export const COLLAPSED_NOTICE_ROWS = 6

export interface NoticeCardSpec {
	/** Title edge: family ('frontend', 'subagent', 'syneva') + settled verb. */
	family: string
	verb: string
	tone: CardTone
	/** The settled activity phase, or an explicit '!' attention glyph. */
	cue: CardCue
	body: string
	footer?: string
}

export class NoticeCard implements Component {
	constructor(
		private readonly view: NoticeCardSpec,
		private readonly expanded: boolean,
	) {}

	invalidate(): void {
		// Pi requires this hook even for stateless renderers.
	}

	render(width: number): string[] {
		const { family, verb, tone, body } = this.view
		const inner = frameContentWidth(width, CARD_INSETS)
		const ink = blendHex(
			UI_COLOR.base,
			UI_COLOR[tone],
			CARD_BORDER_STRENGTH,
		)
		return framedBlock({
			width,
			title: `${this.phaseGlyph()} ${blockTitle(family, verb)}`,
			lines: this.rows(body, inner),
			footer: this.view.footer ?? '',
			insets: CARD_INSETS,
			corners: 'square',
			border: stroke => foregroundHex(ink, stroke),
		})
	}

	/** Settled phases cast static glyphs; only `attention` holds '!'. */
	private phaseGlyph(): string {
		if (this.view.cue === 'attention') return uiTheme.fg('warning', '!')
		const cue = PHASE_CUE[this.view.cue]
		return uiTheme.fg(cue.tone, cue.glyph)
	}

	private rows(body: string, inner: number): string[] {
		const source = body.split('\n')
		const visible = this.expanded
			? source
			: source.slice(0, COLLAPSED_NOTICE_ROWS)
		const lines = visible.flatMap(row =>
			wrapTerminalLine(uiTheme.fg('output', row), inner),
		)
		if (source.length > visible.length)
			lines.push(
				uiTheme.fg(
					'dim',
					`… ${(source.length - visible.length).toString()} more lines`,
				),
			)
		return lines
	}
}

/** Text blocks joined like pi's own default card; non-text content drops. */
export function messageBody(message: { content: unknown }): string {
	if (typeof message.content === 'string') return message.content
	if (!Array.isArray(message.content)) return ''
	return message.content
		.filter(
			block =>
				block &&
				typeof block === 'object' &&
				Reflect.get(block, 'type') === 'text',
		)
		.map(block => Reflect.get(block, 'text'))
		.filter((text): text is string => typeof text === 'string')
		.join('\n')
}

/** A plain object view without type assertions: entries become fresh data. */
export function recordObject(
	record: unknown,
): Record<string, unknown> | undefined {
	if (!record || typeof record !== 'object' || Array.isArray(record))
		return undefined
	return Object.fromEntries(Object.entries(record))
}
