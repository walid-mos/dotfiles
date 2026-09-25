/**
 * The findings checkpoint: a list of gated findings plus the cursor's finding
 * detailed in a scrolling pane. Wide terminals go side-by-side; narrow ones
 * stack the detail under the list, with the detail pane guaranteed its own
 * rows. No line is ever dropped silently: the detail scrolls. Rendering
 * primitives live in select-view.ts; this file is state and keys.
 */

import { Key, matchesKey } from '@earendil-works/pi-tui'

import { uiTheme } from '../ui/design-system/theme.ts'
import { blockTitle, frameContentWidth, framedBlock } from '../ui/frame.ts'
import { columnWidth } from '../ui/terminal-text.ts'

import {
	bodyBudget,
	countByRisk,
	detailLines,
	detailViewport,
	joinColumns,
	keysLine,
	rowLine,
	windowLabel,
	windowedRows,
} from './select-view.ts'

import type {
	ExtensionContext,
	KeybindingsManager,
} from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'
import type { MergedFinding } from './types.ts'

const VISIBLE_ROWS = 10
/** The detail pane is never squeezed below this many rows. */
const MIN_DETAIL_ROWS = 6
/** Content width from which the list and the detail sit side by side. */
const WIDE_SPLIT_MIN = 110
/** Side-by-side chrome: keys, window label and one blank above the panes. */
const SIDE_CHROME_ROWS = 3
/** Stacked chrome adds the blank between the list and the detail. */
const STACKED_CHROME_ROWS = SIDE_CHROME_ROWS + 1
/** Share of the content width the list pane keeps, within its column bounds. */
const LIST_WIDTH_SHARE = 0.4
const LIST_WIDTH_MIN = 44
const LIST_WIDTH_MAX = 84
const PANES_GAP = 2

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

/** Which pane the arrow keys and PageUp/PageDown act on. */
type Pane = 'list' | 'detail'

/** The pane geometry of the last build, until the first render replaces it. */
interface PaneLayout {
	listRows: number
	detailRows: number
}

class FindingsSelector implements Component {
	/** pi-tui sets this; the dialog draws no cursor of its own. */
	focused = false
	private cursor = 0
	private readonly checked = new Set<number>()
	private pane: Pane = 'list'
	private detailScroll = 0
	private layout: PaneLayout = {
		listRows: VISIBLE_ROWS,
		detailRows: MIN_DETAIL_ROWS,
	}
	/** The detail's wrapped length and viewport, for scroll clamping. */
	private detailGeometry = { total: 0, rows: MIN_DETAIL_ROWS }
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
			return this.options.done(undefined)
		if (keybindings.matches(keyData, 'tui.select.confirm'))
			return this.options.done(
				[...this.checked].toSorted((left, right) => left - right),
			)
		if (matchesKey(keyData, Key.tab)) return this.switchPane()
		if (matchesKey(keyData, Key.pageUp)) return this.page(-1)
		if (matchesKey(keyData, Key.pageDown)) return this.page(1)
		if (matchesKey(keyData, Key.up))
			return this.pane === 'detail'
				? this.scrollDetail(-1)
				: this.move(-1)
		if (matchesKey(keyData, Key.down))
			return this.pane === 'detail' ? this.scrollDetail(1) : this.move(1)
		if (matchesKey(keyData, Key.space)) return this.toggle(this.cursor)
		if (keyData === 'a') return this.toggleAll()
		if (/^[1-9]$/u.test(keyData) && Number(keyData) <= findings.length)
			return this.toggle(Number(keyData) - 1)
	}

	private build(width: number): string[] {
		const content = frameContentWidth(width)
		const budget = this.bodyBudget()
		const body =
			content >= WIDE_SPLIT_MIN
				? this.sideBySide(content, budget)
				: this.stacked(content, budget)
		return framedBlock({
			width,
			title: blockTitle('simplify', this.options.label),
			lines: body,
			footer: countByRisk(this.options.findings),
		})
	}

	/** Side-by-side: both panes get the same rows, the detail keeps its width. */
	private sideBySide(content: number, budget: number): string[] {
		const paneRows = Math.max(1, budget - SIDE_CHROME_ROWS)
		this.layout = { listRows: paneRows, detailRows: paneRows }
		const listWidth = Math.min(
			LIST_WIDTH_MAX,
			Math.max(LIST_WIDTH_MIN, Math.round(content * LIST_WIDTH_SHARE)),
		)
		const detailWidth = content - listWidth - PANES_GAP
		const list = this.listPane(listWidth, paneRows)
		const detail = this.detailPane(detailWidth, paneRows)
		const rows = this.headRows(paneRows)
		for (let index = 0; index < paneRows; index += 1)
			rows.push(
				joinColumns(
					list[index] ?? '',
					listWidth,
					detail[index] ?? '',
					PANES_GAP,
				),
			)
		return rows
	}

	/** Stacked: the detail keeps MIN_DETAIL_ROWS, the list takes the rest. */
	private stacked(content: number, budget: number): string[] {
		const listRows = Math.min(
			VISIBLE_ROWS,
			Math.max(1, budget - STACKED_CHROME_ROWS - MIN_DETAIL_ROWS),
		)
		const detailRows = Math.max(1, budget - STACKED_CHROME_ROWS - listRows)
		this.layout = { listRows, detailRows }
		return [
			...this.headRows(listRows),
			...this.listPane(content, listRows),
			'',
			...this.detailPane(content, detailRows),
		]
	}

	/** Keys and window label first: a dialog whose keys are invisible is unusable. */
	private headRows(listRows: number): string[] {
		return [
			uiTheme.fg(
				'muted',
				keysLine(this.checked.size, this.options.findings.length),
			),
			uiTheme.fg('dim', this.labelLine(listRows)),
			'',
		]
	}

	private listPane(width: number, rows: number): string[] {
		return this.visibleRows(rows).map(index => {
			const finding = this.options.findings[index]
			if (!finding) return ''
			return rowLine({
				finding,
				isCursor: index === this.cursor,
				isChecked: this.checked.has(finding.id),
				width,
			})
		})
	}

	/** The detail text scrolled, never dropped; the viewport hints at more. */
	private detailPane(width: number, rows: number): string[] {
		const finding = this.options.findings[this.cursor]
		if (!finding) return Array.from({ length: rows }, () => '')
		const viewport = detailViewport(
			detailLines(finding, width),
			rows,
			this.detailScroll,
		)
		this.detailGeometry = { total: viewport.total, rows: viewport.rows }
		return viewport.lines
	}

	private bodyBudget(): number {
		return bodyBudget(this.options.height())
	}

	/** Window position plus the focused pane, so the keys are discoverable. */
	private labelLine(rows: number): string {
		const visible = this.visibleRows(rows)
		return `${windowLabel(this.options.findings.length, rows, visible)} · focus ${this.pane}`
	}

	private visibleRows(rows: number): number[] {
		return windowedRows(this.options.findings.length, rows, this.cursor)
	}

	private page(direction: -1 | 1): void {
		if (this.pane === 'list')
			return this.move(direction * Math.max(1, this.layout.listRows))
		return this.scrollDetail(
			direction * Math.max(1, this.layout.detailRows),
		)
	}

	private scrollDetail(delta: number): void {
		const { total, rows } = this.detailGeometry
		const ceiling = Math.max(0, total - rows)
		this.detailScroll = Math.min(
			Math.max(0, this.detailScroll + delta),
			ceiling,
		)
		this.refresh()
	}

	private switchPane(): void {
		this.pane = this.pane === 'list' ? 'detail' : 'list'
		this.refresh()
	}

	private move(delta: number): void {
		const total = this.options.findings.length
		if (!total) return
		this.cursor = Math.min(Math.max(0, this.cursor + delta), total - 1)
		this.detailScroll = 0
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
}
