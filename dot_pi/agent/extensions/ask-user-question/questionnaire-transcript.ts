/** Pending preview and answer replay: domain content over shared UI primitives. */
import { DETAIL_INDENT, INSET } from '../ui/align.ts'
import { uiTheme } from '../ui/design-system/theme.ts'
import { blockTitle, framedBlock, frameContentWidth } from '../ui/frame.ts'
import { GLYPH, selectionMarker } from '../ui/selection-marker.ts'
import { pushWrapped } from '../ui/terminal-text.ts'

import { previewLabels } from './questionnaire-transcript-args.ts'

import type { LineSink } from '../ui/terminal-text.ts'
import type { Answer, AskResult, Question } from './questionnaire-model.ts'

function sectionHead(question: Question, width: number, sink: LineSink): void {
	pushWrapped(
		sink,
		INSET,
		`${uiTheme.fg('dim', `[${question.label}]`)} ${uiTheme.fg('text', uiTheme.bold(question.prompt))}`,
		width,
	)
}

export function renderCallLines(args: unknown, width: number): string[] {
	const labels = previewLabels(args)
	const lines: string[] = []
	pushWrapped(
		line => lines.push(line),
		INSET,
		labels.length
			? uiTheme.fg('text', labels.join('  ·  '))
			: uiTheme.fg('dim', 'waiting for questions…'),
		frameContentWidth(width),
	)
	return framedBlock({
		width,
		title: blockTitle(
			'ask',
			labels.length
				? `${labels.length} question${labels.length === 1 ? '' : 's'}`
				: undefined,
		),
		lines,
		footer: uiTheme.fg('dim', 'awaiting answer'),
	})
}

export function renderResultLines(details: AskResult, width: number): string[] {
	if (details.chat) return pendingReplay(details, width, 'chat')
	if (details.cancelled) return pendingReplay(details, width, 'cancelled')
	const lines: string[] = ['']
	const sink: LineSink = line => lines.push(line)
	const contentWidth = frameContentWidth(width)
	for (const question of details.questions) {
		sectionHead(question, contentWidth, sink)
		const answer = details.answers.find(entry => entry.id === question.id)
		if (!answer) {
			sink(`${DETAIL_INDENT}${uiTheme.fg('dim', '· no answer')}`)
			continue
		}
		replayAnswerRows(sink, question, answer, contentWidth)
	}
	lines.push('')
	return framedBlock({
		width,
		title: `${uiTheme.fg('success', GLYPH.done)} ${blockTitle('ask', `${details.answers.length} answer${details.answers.length === 1 ? '' : 's'}`)}`,
		lines,
		footer: uiTheme.fg('dim', 'answered'),
	})
}

function pendingReplay(
	details: AskResult,
	width: number,
	status: 'chat' | 'cancelled',
): string[] {
	const lines: string[] = ['']
	const isChat = status === 'chat'
	const note = isChat ? '· continuing in chat' : '· no answer'
	for (const question of details.questions) {
		sectionHead(question, frameContentWidth(width), line =>
			lines.push(line),
		)
		lines.push(`${DETAIL_INDENT}${uiTheme.fg('dim', note)}`)
	}
	lines.push('')
	const icon = uiTheme.fg(
		isChat ? 'accent' : 'danger',
		isChat ? GLYPH.chat : GLYPH.cancel,
	)
	return framedBlock({
		width,
		title: `${icon} ${blockTitle('ask', status)}`,
		lines,
		footer: uiTheme.fg('dim', isChat ? 'chat redirect' : 'cancelled'),
	})
}

function replayAnswerRows(
	sink: LineSink,
	question: Question,
	answer: Answer,
	width: number,
): void {
	if (answer.wasCustom) {
		pushCustomRow(sink, answer.label, width)
		return
	}
	question.options.forEach((option, index) => {
		const isChecked =
			answer.kind === 'multi'
				? answer.optionValues.includes(option.value)
				: option.value === answer.value || answer.index === index + 1
		const label = uiTheme.fg(isChecked ? 'text' : 'dim', option.label)
		const marker = selectionMarker({ kind: answer.kind, isChecked })
		pushWrapped(sink, `${DETAIL_INDENT}${marker} `, label, width)
	})
	if (answer.kind === 'multi' && answer.customText)
		pushCustomRow(sink, answer.customText, width)
}

function pushCustomRow(sink: LineSink, label: string, width: number): void {
	pushWrapped(
		sink,
		`${DETAIL_INDENT}${uiTheme.fg('success', GLYPH.pen)} `,
		uiTheme.fg('text', label),
		width,
	)
}
