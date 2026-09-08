/**
 * Shared rendering plumbing for the questionnaire UI modules: color surface,
 * render types and the wrapping helper. No screen logic lives here.
 */

import {
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from '@earendil-works/pi-tui'

import type { Question } from './questionnaire-model.ts'
import type { QuestionnaireState } from './questionnaire-state.ts'

/** Minimal color surface this renderer needs - structurally compatible with
 * the TUI theme, which has more colors than we use. */
export interface QuestionnairePalette {
	fg(
		color: 'accent' | 'muted' | 'dim' | 'warning' | 'text',
		text: string,
	): string
	bold(text: string): string
}

export type LineSink = (line: string) => void

/** Vanilla editor surface the renderer needs (the real TUI editor has more). */
export interface RenderEditor {
	getText(): string
	render(width: number): string[]
}

/** Everything needed to draw one questionnaire frame. */
export interface QuestionnaireView {
	state: QuestionnaireState
	questions: readonly Question[]
	editor: RenderEditor
	theme: QuestionnairePalette
	width: number
}

/** A view plus the output channel its helpers write to. */
export interface RenderPass extends QuestionnaireView {
	sink: LineSink
}

export const CURSOR_PREFIX = '> '
export const QUIET_PREFIX = '  '
/** Horizontal room kept for the cursor prefix when inlining the editor. */
export const CURSOR_PREFIX_WIDTH = 2

/** Wrap text and push each visual line, hanging-indenting under `prefix`. */
export function pushWrappedWithPrefix(
	sink: LineSink,
	prefix: string,
	text: string,
	width: number,
): void {
	const prefixWidth = visibleWidth(prefix)
	if (prefixWidth >= width) {
		for (const line of wrapTextWithAnsi(prefix + text, width)) sink(line)
		return
	}
	const wrapped = wrapTextWithAnsi(text, width - prefixWidth)
	const continuation = ' '.repeat(prefixWidth)
	for (let i = 0; i < wrapped.length; i++) {
		sink(`${i === 0 ? prefix : continuation}${wrapped[i]}`)
	}
}

/** Render boundary: no line may exceed the current terminal width, even when
 * an embedded Editor changes its padding. */
export function truncateSink(lines: string[], width: number): LineSink {
	return line =>
		lines.push(
			visibleWidth(line) <= width ? line : truncateToWidth(line, width),
		)
}
