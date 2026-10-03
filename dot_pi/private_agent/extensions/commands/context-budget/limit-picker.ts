/** A searchable, keyboard-operated limit list using Pi's input and selection widgets. */
import { Input, Key, matchesKey, SelectList } from '@earendil-works/pi-tui'

import { uiTheme } from '#lib/ui/design-system/theme.ts'
import { blockTitle, framedBlock, frameContentWidth } from '#lib/ui/frame.ts'

import { CEILING_PRESETS, ceilingLabel, ceilingMatches } from './choices.ts'

import type { Component, Focusable, SelectItem } from '@earendil-works/pi-tui'

const MAX_VISIBLE_ROWS = 16
const CHROME_ROWS = 5
const RESERVED_ROWS = 2
const selectTheme = {
	selectedPrefix: (text: string) => uiTheme.fg('accent', text),
	selectedText: (text: string) => uiTheme.fg('accent', uiTheme.bold(text)),
	description: (text: string) => uiTheme.fg('dim', text),
	scrollInfo: (text: string) => uiTheme.fg('dim', text),
	noMatch: (text: string) => uiTheme.fg('muted', text),
}

export interface LimitPickerInput {
	configuredTokens: number
	minimumTokens: number
	modelCapTokens: number
	height: () => number
	repaint: () => void
	done: (tokens: number | undefined) => void
}

export class LimitPicker implements Component, Focusable {
	private readonly input = new Input({
		prompt: 'Search: ',
		placeholder: 'type a token limit',
	})
	private readonly ceilings: number[]
	private selectList: SelectList
	private selectionIndex = 0
	private filter = ''
	private rowCount = 0

	constructor(private readonly options: LimitPickerInput) {
		this.ceilings = [
			...new Set([
				...CEILING_PRESETS.filter(
					tokens => tokens >= options.minimumTokens,
				),
				options.configuredTokens,
			]),
		].toSorted((first, second) => first - second)
		this.selectList = this.buildList(options.configuredTokens)
	}

	get focused(): boolean {
		return this.input.focused
	}
	set focused(isFocused: boolean) {
		this.input.focused = isFocused
	}

	private filteredItems(): SelectItem[] {
		return this.ceilings
			.filter(tokens => ceilingMatches(tokens, this.filter))
			.map(tokens => ({
				value: String(tokens),
				label: `${ceilingLabel(tokens)}${tokens === this.options.configuredTokens ? ' · current' : ''}`,
				description:
					tokens > this.options.modelCapTokens
						? `uses ${ceilingLabel(this.options.modelCapTokens)} on this model`
						: `${tokens.toLocaleString('en-US')} tokens`,
			}))
	}

	private visibleRows(): number {
		return Math.max(
			1,
			Math.min(
				MAX_VISIBLE_ROWS,
				this.options.height() - CHROME_ROWS - RESERVED_ROWS,
			),
		)
	}

	private selectedTokens(): number {
		const selected = this.selectList.getSelectedItem()
		return selected ? Number(selected.value) : this.options.configuredTokens
	}

	private buildList(preferred: number): SelectList {
		const choices = this.filteredItems()
		this.rowCount = this.visibleRows()
		const list = new SelectList(choices, this.rowCount, selectTheme)
		this.selectionIndex = Math.max(
			0,
			choices.findIndex(choice => Number(choice.value) === preferred),
		)
		list.setSelectedIndex(this.selectionIndex)
		return list
	}

	private selectIndex(index: number): void {
		this.selectionIndex = Math.max(
			0,
			Math.min(this.filteredItems().length - 1, index),
		)
		this.selectList.setSelectedIndex(this.selectionIndex)
		this.options.repaint()
	}

	private updateFilter(): void {
		const digits = this.input.getValue().replace(/\D/g, '')
		if (digits !== this.input.getValue()) this.input.setValue(digits)
		if (digits === this.filter) return
		const selected = this.selectedTokens()
		this.filter = digits
		this.selectList = this.buildList(selected)
	}

	invalidate(): void {
		this.selectList.invalidate()
		this.input.invalidate()
	}

	render(width: number): string[] {
		if (this.rowCount !== this.visibleRows())
			this.selectList = this.buildList(this.selectedTokens())
		const contentWidth = frameContentWidth(width)
		const configured = this.options.configuredTokens
		const effective = Math.min(configured, this.options.modelCapTokens)
		return framedBlock({
			title: blockTitle('Context Budget limit'),
			width,
			footer: '↑↓ move · PgUp/PgDn page · Home/End · Enter save · Esc cancel',
			lines: [
				uiTheme.fg(
					'dim',
					`${ceilingLabel(configured)} saved · ${ceilingLabel(effective)} in use · ${this.ceilings.length} limits`,
				),
				...this.input.render(contentWidth),
				...this.selectList.render(contentWidth),
			],
		})
	}

	handleInput(keyData: string): void {
		if (matchesKey(keyData, Key.escape)) return this.options.done(undefined)
		if (matchesKey(keyData, Key.enter)) {
			const selected = this.selectList.getSelectedItem()
			if (selected) this.options.done(Number(selected.value))
			return
		}
		if (matchesKey(keyData, Key.up))
			return this.selectIndex(this.selectionIndex - 1)
		if (matchesKey(keyData, Key.down))
			return this.selectIndex(this.selectionIndex + 1)
		if (matchesKey(keyData, Key.pageUp))
			return this.selectIndex(this.selectionIndex - this.rowCount)
		if (matchesKey(keyData, Key.pageDown))
			return this.selectIndex(this.selectionIndex + this.rowCount)
		if (matchesKey(keyData, Key.home)) return this.selectIndex(0)
		if (matchesKey(keyData, Key.end))
			return this.selectIndex(this.filteredItems().length - 1)
		this.input.handleInput(keyData)
		this.updateFilter()
		this.options.repaint()
	}
}
