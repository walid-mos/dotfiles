/** Pending preview and answer replay: domain content over shared UI primitives. */
import { renderAttachmentStrip } from '../attachments/attachment-strip.ts'
import {
	toPromptCapture,
	snapshotPreviews,
} from '../attachments/transcript-entry.ts'
import { DETAIL_INDENT, INSET } from '../ui/align.ts'
import { uiTheme } from '../ui/design-system/theme.ts'
import { blockTitle, framedBlock, frameContentWidth } from '../ui/frame.ts'
import { GLYPH, selectionMarker } from '../ui/selection-marker.ts'
import { pushWrapped } from '../ui/terminal-text.ts'

import { previewLabels } from './questionnaire-transcript-args.ts'

import type { Theme } from '@earendil-works/pi-coding-agent'
import type { TranscriptCapture } from '../attachments/transcript-entry.ts'
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

export function renderResultLines(
	details: AskResult,
	width: number,
	theme: Theme,
): string[] {
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
		replayAnswerRows(sink, {
			question,
			answer,
			width: contentWidth,
			strip: answerCaptures(
				answer,
				details.captures ?? [],
				theme,
				contentWidth,
			),
		})
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

/** One answer's replay layout: its rows and the strip directly above its text. */
interface ReplayAnswer {
	readonly question: Question
	readonly answer: Answer
	readonly width: number
	readonly strip: readonly string[]
}

function replayAnswerRows(sink: LineSink, replay: ReplayAnswer): void {
	const { question, answer, width, strip } = replay
	if (answer.wasCustom) {
		for (const row of strip) sink(row)
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
	if (answer.kind === 'multi' && answer.customText) {
		for (const row of strip) sink(row)
		pushCustomRow(sink, answer.customText, width)
	}
}

/**
 * Strip rows above the user-written text, exactly like the prompt replays:
 * the captures whose alias that text cites, as tile-sized snapshot records.
 */
function answerCaptures(
	answer: Answer,
	snapshot: readonly TranscriptCapture[],
	theme: Theme,
	width: number,
): string[] {
	const text = answerCapturedText(answer)
	const captures = snapshot.filter(capture => text.includes(capture.alias))
	if (!captures.length) return []
	return pushIndent(
		renderAttachmentStrip({
			captures: captures.map(toPromptCapture),
			scrollOffset: 0,
			// Reserve this row's own indent so the frame never clips a tile.
			width: Math.max(0, width - DETAIL_INDENT.length),
			theme,
			previews: snapshotPreviews,
		}),
	)
}

/** The user-written text the strip replays beside: any committed custom text. */
function answerCapturedText(answer: Answer): string {
	if (answer.kind !== 'multi' || !answer.customText) return answer.label
	return answer.customText
}

function pushCustomRow(sink: LineSink, label: string, width: number): void {
	pushWrapped(
		sink,
		`${DETAIL_INDENT}${uiTheme.fg('success', GLYPH.pen)} `,
		uiTheme.fg('text', label),
		width,
	)
}

/** One detail indent per strip row, aligning capture tiles under their text. */
function pushIndent(rows: readonly string[]): string[] {
	return rows.map(row => `${DETAIL_INDENT}${row}`)
}
