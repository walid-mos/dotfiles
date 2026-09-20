/**
 * The findings checkpoint: one checkbox row per gated finding, the cursor's
 * finding detailed below it. House chrome only - frame, theme and selection
 * glyphs come from ui/, never from the runtime theme. The body is fitted to the
 * terminal so the footer (which carries the keys) is never pushed off-screen.
 */

import { Key, matchesKey } from '@earendil-works/pi-tui'

import { uiTheme } from '../ui/design-system/theme.ts'
import {
	blockTitle,
	frameContentWidth,
	framedBlock,
	highlightRow,
} from '../ui/frame.ts'
import { selectionMarker } from '../ui/selection-marker.ts'
import {
	columnWidth,
	pushWrapped,
	truncateTerminalLine,
} from '../ui/terminal-text.ts'

import type {
	ExtensionContext,
	KeybindingsManager,
} from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'
import type { MergedFinding, Risk } from './types.ts'

const VISIBLE_ROWS = 10
const MIDPOINT_DIVISOR = 2
/** The frame's own two strokes, plus room for the editor below the dialog. */
const CHROME_ROWS = 2
const SCREEN_MARGIN = 2
/** Hint line, two blanks and one detail line must always fit. */
const MIN_BODY_ROWS = 4
const FALLBACK_BODY_ROWS = 24

const RISK_COLOR: Record<Risk, 'success' | 'warning' | 'danger'> = {
	safe: 'success',
	confirm: 'warning',
	review: 'danger',
}

export interface FindingsSelectorInput {
	findings: readonly MergedFinding[]
	/** What the run analysed, shown beside the title. */
	label: string
}

/** The selected finding ids, or undefined when the user cancelled. */
export function showFindingsSelector(
	ctx: ExtensionContext,
	input: FindingsSelectorInput,
): Promise<number[] | undefined> {
	return ctx.ui.custom<number[] | undefined>(
		(tui, _theme, keybindings, done) =>
			new FindingsSelector({
				...input,
				keybindings,
				height: () => tui.terminal.rows,
				repaint: () => tui.requestRender(),
				done,
			}),
	)
}

interface SelectorOptions extends FindingsSelectorInput {
	keybindings: Pick<KeybindingsManager, 'matches'>
	/** Terminal rows, so a long detail pane cannot hide the key hints. */
	height: () => number
	repaint: () => void
	done: (result: number[] | undefined) => void
}

class FindingsSelector implements Component {
	/** pi-tui sets this; the dialog draws no cursor of its own. */
	focused = false
	private cursor = 0
	private readonly checked = new Set<number>()
	private cache: { width: number; lines: string[] } | undefined

	constructor(private readonly options: SelectorOptions) {}

	invalidate(): void {
		this.cache = undefined
	}

	render(width: number): string[] {
		const budget = columnWidth(width)
		if (this.cache?.width === budget) return this.cache.lines
		const lines = this.build(budget)
		this.cache = { width: budget, lines }
		return lines
	}

	handleInput(keyData: string): void {
		const { keybindings, findings } = this.options
		if (keybindings.matches(keyData, 'tui.select.cancel'))
			return this.finish(undefined)
		if (keybindings.matches(keyData, 'tui.select.confirm'))
			return this.finish(
				[...this.checked].toSorted((left, right) => left - right),
			)
		if (keybindings.matches(keyData, 'tui.select.up')) return this.move(-1)
		if (keybindings.matches(keyData, 'tui.select.down')) return this.move(1)
		if (keybindings.matches(keyData, 'tui.select.pageUp'))
			return this.move(-this.rowCount())
		if (keybindings.matches(keyData, 'tui.select.pageDown'))
			return this.move(this.rowCount())
		if (matchesKey(keyData, Key.space)) return this.toggle(this.cursor)
		if (keyData === 'a') return this.toggleAll()
		if (/^[1-9]$/u.test(keyData) && Number(keyData) <= findings.length)
			return this.toggle(Number(keyData) - 1)
	}

	private build(width: number): string[] {
		const content = frameContentWidth(width)
		const rows = this.rowCount()
		const body = [
			uiTheme.fg('muted', this.keysLine()),
			uiTheme.fg('dim', this.windowLabel(rows)),
			'',
			...this.visibleRows(rows).map(index =>
				this.rowLine(index, content),
			),
			'',
			...this.detailLines(content),
		]
		return framedBlock({
			width,
			title: blockTitle('simplify', this.options.label),
			lines: fitToHeight(body, this.bodyBudget()),
			footer: countByRisk(this.options.findings),
		})
	}

	/**
	 * The keys live in the first content row, not in the frame footer: a long
	 * detail pane can push the bottom line out of the visible region, and a
	 * dialog whose keys are invisible is unusable.
	 */
	private keysLine(): string {
		const { findings } = this.options
		return `${this.checked.size}/${findings.length} selected · space toggle · a all · enter apply · esc skip`
	}

	/** How many list rows the body budget allows. */
	private rowCount(): number {
		const usable = this.bodyBudget() - MIN_BODY_ROWS
		return Math.max(1, Math.min(VISIBLE_ROWS, usable))
	}

	private bodyBudget(): number {
		const rows = this.options.height()
		if (!Number.isFinite(rows) || rows <= 0) return FALLBACK_BODY_ROWS
		return Math.max(
			MIN_BODY_ROWS,
			Math.floor(rows) - SCREEN_MARGIN - CHROME_ROWS,
		)
	}

	private windowLabel(rows: number): string {
		const total = this.options.findings.length
		if (total <= rows) return `${total} finding(s) needing a decision`
		const visible = this.visibleRows(rows)
		const first = (visible[0] ?? 0) + 1
		const last = (visible.at(-1) ?? 0) + 1
		return `findings ${first}-${last} of ${total} - up/down to scroll, the applier reads every selection`
	}

	private rowLine(index: number, content: number): string {
		const finding = this.options.findings[index]
		if (!finding) return ''
		const marker = selectionMarker({
			kind: 'multi',
			isChecked: this.checked.has(finding.id),
		})
		const risk = uiTheme.fg(RISK_COLOR[finding.risk], finding.risk)
		const where = uiTheme.fg('dim', `${finding.file}:${finding.lines}`)
		const line = truncateTerminalLine(
			`${marker} ${uiTheme.bold(`#${finding.id}`)} ${risk} ${where} ${finding.rootIssue}`,
			content,
			'…',
		)
		return index === this.cursor ? highlightRow(line, content) : line
	}

	private detailLines(content: number): string[] {
		const finding = this.options.findings[this.cursor]
		if (!finding) return []
		const detail: string[] = []
		const push = (line: string): void => {
			detail.push(line)
		}
		detail.push(
			`${uiTheme.fg(RISK_COLOR[finding.risk], `risk ${finding.risk}`)} ${uiTheme.fg('dim', `action ${finding.action} · lens ${finding.lenses.join(', ')}`)}`,
		)
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
		pushWrapped(
			push,
			uiTheme.fg('muted', 'gain   '),
			finding.benefit,
			content,
		)
		pushWrapped(
			push,
			uiTheme.fg('muted', 'proof  '),
			finding.evidence,
			content,
		)
		return detail
	}

	private visibleRows(rows: number): number[] {
		const total = this.options.findings.length
		if (total <= rows) return range(total)
		const half = Math.floor(rows / MIDPOINT_DIVISOR)
		const start = Math.min(
			Math.max(0, this.cursor - half),
			Math.max(0, total - rows),
		)
		return range(rows).map(offset => start + offset)
	}

	private move(delta: number): void {
		const total = this.options.findings.length
		if (!total) return
		this.cursor = Math.min(Math.max(0, this.cursor + delta), total - 1)
		this.refresh()
	}

	private toggle(index: number): void {
		const finding = this.options.findings[index]
		if (!finding) return
		if (this.checked.has(finding.id)) this.checked.delete(finding.id)
		else this.checked.add(finding.id)
		this.refresh()
	}

	private toggleAll(): void {
		const all = this.options.findings.every(finding =>
			this.checked.has(finding.id),
		)
		this.checked.clear()
		if (!all)
			for (const finding of this.options.findings)
				this.checked.add(finding.id)
		this.refresh()
	}

	private refresh(): void {
		this.cache = undefined
		this.options.repaint()
	}

	private finish(selection: number[] | undefined): void {
		this.options.done(selection)
	}
}

/** Body lines beyond the budget are dropped; the frame and the keys stay. */
function fitToHeight(body: readonly string[], budget: number): string[] {
	if (body.length <= budget) return [...body]
	return [
		...body.slice(0, budget - 1),
		uiTheme.fg('dim', '… more detail for this finding'),
	]
}

function countByRisk(findings: readonly MergedFinding[]): string {
	const counts = { safe: 0, confirm: 0, review: 0 }
	for (const finding of findings) counts[finding.risk] += 1
	return `safe ${counts.safe} · confirm ${counts.confirm} · review ${counts.review}`
}

function range(count: number): number[] {
	return Array.from({ length: count }, (_value, index) => index)
}
