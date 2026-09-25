/**
 * Pure rendering for the findings checkpoint: one list row, the wrapped detail
 * of the cursor's finding, its scrolling viewport and the pane join. No state,
 * no keys - the component in select-ui.ts owns those and calls these.
 */

import { uiTheme } from '../ui/design-system/theme.ts'
import { highlightRow } from '../ui/frame.ts'
import { selectionMarker } from '../ui/selection-marker.ts'
import {
	pushWrapped,
	terminalLineWidth,
	truncateTerminalLine,
} from '../ui/terminal-text.ts'

import type { MergedFinding, Risk } from './types.ts'

/** Half the viewport the cursor row tries to sit at the middle of. */
const WINDOW_HALF_DIVISOR = 2
/** The frame's own two strokes, plus room for the editor below the dialog. */
const CHROME_ROWS = 2
const SCREEN_MARGIN = 2
/** Keys, window label, one blank, list row(s) and the detail pane must fit. */
const MIN_BODY_ROWS = 10
const FALLBACK_BODY_ROWS = 24

const RISK_COLOR: Record<Risk, 'success' | 'warning' | 'danger'> = {
	safe: 'success',
	confirm: 'warning',
	review: 'danger',
}

export interface RowInput {
	finding: MergedFinding
	isCursor: boolean
	isChecked: boolean
	width: number
}

/** Body rows the terminal allows: the frame strokes and editor are reserved. */
export function bodyBudget(rows: number): number {
	if (!Number.isFinite(rows) || rows <= 0) return FALLBACK_BODY_ROWS
	return Math.max(
		MIN_BODY_ROWS,
		Math.floor(rows) - SCREEN_MARGIN - CHROME_ROWS,
	)
}

/**
 * One list row: marker, id, risk, the finding's short title, then the dim
 * location. The full story lives in the detail pane, so the row stays
 * scannable instead of clipping mid-sentence.
 */
export function rowLine(input: RowInput): string {
	const { finding, isCursor, isChecked, width } = input
	const marker = selectionMarker({ kind: 'multi', isChecked })
	const risk = uiTheme.fg(RISK_COLOR[finding.risk], finding.risk)
	const where = uiTheme.fg('dim', `${finding.file}:${finding.lines}`)
	const line = truncateTerminalLine(
		`${marker} ${uiTheme.bold(`#${finding.id}`)} ${risk} ${finding.title} ${where}`,
		width,
		'…',
	)
	return isCursor ? highlightRow(line, width) : line
}

/** The selected finding's full story, wrapped at the pane width. */
export function detailLines(finding: MergedFinding, content: number): string[] {
	const detail: string[] = []
	detail.push(
		`${uiTheme.fg(RISK_COLOR[finding.risk], `risk ${finding.risk}`)} ${uiTheme.fg('dim', `action ${finding.action} · lens ${finding.lenses.join(', ')}`)}`,
	)
	const push = (line: string): void => {
		detail.push(line)
	}
	pushWrapped(
		push,
		uiTheme.fg('muted', 'issue  '),
		finding.rootIssue,
		content,
	)
	pushWrapped(
		push,
		uiTheme.fg('muted', 'cost   '),
		finding.consequence,
		content,
	)
	pushWrapped(push, uiTheme.fg('muted', 'gain   '), finding.benefit, content)
	pushWrapped(push, uiTheme.fg('muted', 'proof  '), finding.evidence, content)
	return detail
}

export interface DetailViewport {
	/** Exactly `rows` lines; empty strings pad a short tail. */
	lines: string[]
	/** Wrapped detail length, for scroll clamping between renders. */
	total: number
	rows: number
	/** First visible detail line, for the position hint. */
	first: number
}

/**
 * The detail text scrolled, never dropped: one dim line points below when
 * more of the pane is waiting.
 */
export function detailViewport(
	full: readonly string[],
	rows: number,
	scroll: number,
): DetailViewport {
	if (!full.length) {
		return {
			lines: Array.from({ length: rows }, () => ''),
			total: 0,
			rows,
			first: 0,
		}
	}
	const first = Math.min(scroll, Math.max(0, full.length - rows))
	const view = full.slice(first, first + rows)
	if (full.length > rows) {
		const hint = `detail ${first + 1}-${Math.min(first + rows, full.length)} of ${full.length}`
		view[rows - 1] = uiTheme.fg(
			'dim',
			`▾ ${hint} · tab focuses the detail pane`,
		)
	}
	return {
		lines: Array.from({ length: rows }, (_, index) => view[index] ?? ''),
		total: full.length,
		rows,
		first,
	}
}

/** Left column padded to its width, the detail pane beside it. */
export function joinColumns(
	list: string,
	listWidth: number,
	detail: string,
	gap: number,
): string {
	const padded = truncateTerminalLine(list, listWidth, '…')
	const padding = ' '.repeat(
		Math.max(0, listWidth - terminalLineWidth(padded)),
	)
	return `${padded}${padding}${' '.repeat(gap)}${detail}`
}

/** The list rows in view: all of them when they fit, else a cursor window. */
export function windowedRows(
	total: number,
	rows: number,
	cursor: number,
): number[] {
	if (total <= rows) return Array.from({ length: total }, (_, index) => index)
	const half = Math.floor(rows / WINDOW_HALF_DIVISOR)
	const start = Math.min(
		Math.max(0, cursor - half),
		Math.max(0, total - rows),
	)
	return Array.from({ length: rows }, (_, offset) => start + offset)
}

export function countByRisk(findings: readonly MergedFinding[]): string {
	const counts = { safe: 0, confirm: 0, review: 0 }
	for (const finding of findings) counts[finding.risk] += 1
	return `safe ${counts.safe} · confirm ${counts.confirm} · review ${counts.review}`
}

export function keysLine(selected: number, total: number): string {
	return `${selected}/${total} selected · space toggle · a all · enter apply · esc skip · tab panes`
}

export function windowLabel(
	total: number,
	rows: number,
	visible: readonly number[],
): string {
	if (total <= rows) return `${total} finding(s) needing a decision`
	const first = (visible[0] ?? 0) + 1
	const last = (visible.at(-1) ?? 0) + 1
	return `findings ${first}-${last} of ${total} - up/down to scroll, the applier reads every selection`
}
