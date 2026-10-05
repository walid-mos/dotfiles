/** The bash job card: Pi's completion follow-up message for owned background
 * commands, rendered through `registerMessageRenderer` (the producer
 * extension's own card, like the model-fallback transcript card) instead of
 * the default `[customType]` box. The card keeps the tool panel geometry and
 * status vocabulary: square frame on the activity content column, status
 * glyph on the title edge, house timing on the same edge, and the title
 * word is the job's program identity derived from the minted command
 * (`pnpm lint`, `grep`, `node render-cards.mjs`), not the generic `job`.
 * Collapsed, the body is the bounded output preview - up to six rows with a
 * `... N more lines` row - because the compound command text itself is
 * detail, not summary; Ctrl+O restores the verbatim command, every output
 * row plus `cwd`/`receipt`/`full output`. Receipts and diagnostics always
 * visible, the `bash action=status` contract as the footer, and a frame ink
 * blended toward the status role the way mutation panels blend their border.
 * The follow-up text for the model is untouchable: the card only
 * re-presents the very content the guard minted, and a malformed payload
 * returns `undefined`, so Pi's native fallback keeps the stored message
 * readable instead of erasing evidence. No animation, no clock: a completion
 * card only shows settled facts. */
import { Value } from 'typebox/value'

import { renderActivityStatus } from '#lib/ui/activity-line.ts'
import { formatActivityDuration } from '#lib/ui/activity-timing.ts'
import {
	blendHex,
	foregroundHex,
} from '#lib/ui/design-system/terminal-color.ts'
import { UI_COLOR, uiTheme } from '#lib/ui/design-system/theme.ts'
import { blockTitle, framedBlock, frameContentWidth } from '#lib/ui/frame.ts'
import { CARD_BORDER_STRENGTH, CARD_INSETS } from '#lib/ui/message-card.ts'
import { wrapTerminalLine } from '#lib/ui/terminal-text.ts'

import { jobSnapshotSchema as JobSnapshotSchema } from './bash-job-schema.ts'

import type {
	ExtensionAPI,
	MessageRenderer,
} from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'
import type { JobSnapshot } from './bash-job-schema.ts'

export const BASH_JOB_DONE_TYPE = 'pi-bash-job-complete'

const NOTIFICATION_LEAD = 'Background command finished: '
const GUIDANCE_LEAD = 'Use bash action=status with this jobId'
/** Output rows kept while a card is collapsed; Ctrl+O reveals them all. */
const COLLAPSED_OUTPUT_ROWS = 6

/** Shell noise the identity helper ignores: env assignments, compound joints
 * (&&, ||, ;, |), redirections and cd segments. */
const COMPOUND_SPLIT = / (?:&&|\|\||;|\|) /g
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const LANGUAGE_RUNNERS = new Set([
	'node',
	'deno',
	'tsx',
	'ts-node',
	'python3',
	'python',
	'ruby',
])
const HANDLED_PROGRAMS = new Set(['sh', 'bash', 'zsh', 'timeout'])
const PACKAGE_RUNNERS = new Set([
	'pnpm',
	'npm',
	'yarn',
	'pnpx',
	'npx',
	'bun',
	'bunx',
])
const RUNNER_VERBS = new Set(['run', 'exec', 'x'])

/** The title word one command segment yields, or nothing to keep scanning:
 * package-runner verbs fold in (`pnpm run lint` → `pnpm lint`) and
 * interpreter scripts reduce to their file name. */
function identityForSegment(
	program: string,
	args: ReadonlyArray<string>,
): string | undefined {
	if (
		(HANDLED_PROGRAMS.has(program) && args.length) ||
		program === 'cd' ||
		program === 'pushd'
	)
		return undefined
	if (PACKAGE_RUNNERS.has(program)) {
		const verb = args.find(
			word => !word.startsWith('-') && !RUNNER_VERBS.has(word),
		)
		if (verb) return `${program} ${verb}`
		return undefined
	}
	if (LANGUAGE_RUNNERS.has(program)) {
		const script = args.find(word => !word.startsWith('-'))
		if (script) {
			const file = script.split('/').at(-1) ?? script
			return file === program ? program : `${program} ${file}`
		}
		return undefined
	}
	const file = program.split('/').at(-1) ?? program
	return file
}

/** The title word the card is known by: the first meaningful program in the
 * minted command. A command the helper cannot read keeps the generic `job`
 * word. */
function commandIdentity(command: string): string {
	for (const segment of command.split(COMPOUND_SPLIT)) {
		const words = segment
			.trim()
			.split(/\s+/)
			.filter(word => word && !ENV_ASSIGNMENT.test(word))
			.filter(word => !/^(?:\d|&)?[<>]|^\d?>&\d?$/.test(word))
		const [program = '', ...args] = words
		if (!program) continue
		const identity = identityForSegment(program, args)
		if (identity) return identity
	}
	return 'job'
}

const DONE_PHASE = {
	completed: 'success',
	failed: 'error',
} as const
const DONE_INK = {
	completed: 'success',
	failed: 'danger',
} as const

/** A completion card shows a settled job; other snapshots keep pi's fallback. */
type DoneStatus = keyof typeof DONE_PHASE
function doneStatus(status: JobSnapshot['status']): DoneStatus | undefined {
	if (status === 'completed' || status === 'failed') return status
	return undefined
}

interface JobDoneRender {
	snapshot: JobSnapshot
	status: DoneStatus
	outputRows: string[]
}

/** Frame stroke derived from the card's own status tone. */
function cardBorder(tone: keyof typeof UI_COLOR): (stroke: string) => string {
	const ink = blendHex(UI_COLOR.base, UI_COLOR[tone], CARD_BORDER_STRENGTH)
	return stroke => foregroundHex(ink, stroke)
}

/** Body rows exactly as the follow-up minted them, wrapped at the panel width. */
function outputLineRows(body: string, inner: number): string[] {
	return body
		.split('\n')
		.flatMap(row => wrapTerminalLine(uiTheme.fg('output', row), inner))
}

/**
 * The card renders only what the follow-up text itself carries: the minted
 * snapshot json on the first line, the bounded output preview until the
 * guidance line. Typebox checks the live snapshot schema, so a foreign or
 * stale payload falls back to Pi's own rendering instead of inventing fields.
 */
function parseCompletion(content: string): JobDoneRender | undefined {
	const [lead = '', ...rows] = content.split('\n')
	const payload = lead.startsWith(NOTIFICATION_LEAD)
		? lead.slice(NOTIFICATION_LEAD.length)
		: ''
	try {
		const snapshot = Value.Parse(JobSnapshotSchema, JSON.parse(payload))
		const status = doneStatus(snapshot.status)
		if (!status) return undefined
		const outputRows = rows.at(-1)?.startsWith(GUIDANCE_LEAD)
			? rows.slice(0, -1)
			: rows
		const blank = outputRows.length && outputRows.every(row => row === '')
		return {
			snapshot,
			status,
			outputRows: blank ? [] : outputRows,
		}
	} catch {
		return undefined
	}
}

class JobDoneCard implements Component {
	constructor(
		private readonly view: JobDoneRender,
		private readonly expanded: boolean,
	) {}

	invalidate(): void {
		// Pi requires this hook even for stateless renderers.
	}

	render(width: number): string[] {
		const { status, snapshot } = this.view
		const inner = frameContentWidth(width, CARD_INSETS)
		const glyph = renderActivityStatus(DONE_PHASE[status], Date.now())
		const elapsed = formatActivityDuration(this.elapsed())
		return framedBlock({
			width,
			title: `${glyph} ${blockTitle(commandIdentity(snapshot.command), elapsed)}`,
			lines: this.rows(inner),
			footer: uiTheme.fg('dim', `bash action=status ${snapshot.jobId}`),
			insets: CARD_INSETS,
			corners: 'square',
			border: cardBorder(DONE_INK[status]),
		})
	}

	private elapsed(): number | undefined {
		const { startedAt, finishedAt } = this.view.snapshot
		if (typeof finishedAt !== 'number') return undefined
		return Math.max(0, finishedAt - startedAt)
	}

	private rows(inner: number): string[] {
		const { snapshot } = this.view
		const rows: string[] = []
		for (const diagnostic of [
			snapshot.persistenceError,
			snapshot.notificationError,
		].filter((caused): caused is string => Boolean(caused)))
			rows.push(
				...wrapTerminalLine(
					uiTheme.fg('warning', `! ${diagnostic}`),
					inner,
				),
			)
		rows.push(...this.outputRows(inner))
		if (!this.expanded) return rows
		rows.push(...outputLineRows(snapshot.command, inner))
		if (snapshot.fullOutputPath)
			rows.push(
				...wrapTerminalLine(
					uiTheme.fg('dim', `full output ${snapshot.fullOutputPath}`),
					inner,
				),
			)
		rows.push(
			...wrapTerminalLine(
				uiTheme.fg('dim', `cwd ${snapshot.cwd}`),
				inner,
			),
		)
		if (
			snapshot.receiptPath &&
			snapshot.receiptPath !== snapshot.fullOutputPath
		)
			rows.push(
				...wrapTerminalLine(
					uiTheme.fg('dim', `receipt ${snapshot.receiptPath}`),
					inner,
				),
			)
		return rows
	}

	private outputRows(inner: number): string[] {
		const rows = this.view.outputRows
		if (this.expanded) return outputLineRows(rows.join('\n'), inner)
		const visible = Math.min(COLLAPSED_OUTPUT_ROWS, rows.length)
		const lines = outputLineRows(rows.slice(0, visible).join('\n'), inner)
		if (rows.length > visible)
			lines.push(
				uiTheme.fg(
					'dim',
					`… ${(rows.length - visible).toString()} more lines`,
				),
			)
		return lines
	}
}

/** Registers pi-bash-job-complete's display; one card per completion message. */
export function registerJobDoneCard(pi: ExtensionAPI): void {
	const render: MessageRenderer<unknown> = (message, { expanded }) => {
		const body = typeof message.content === 'string' ? message.content : ''
		const view = parseCompletion(body)
		if (!view) return undefined
		return new JobDoneCard(view, expanded)
	}
	pi.registerMessageRenderer<unknown>(BASH_JOB_DONE_TYPE, render)
}
