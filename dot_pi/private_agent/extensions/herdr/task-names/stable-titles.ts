/** Unchanged declared work keeps its exact title when another pane changes. */
import { createHash } from 'node:crypto'

import type { SavedState, Titles } from './contracts.ts'
import type { TitleInput } from './tasks.ts'

const key = (content: unknown): string =>
	createHash('sha256').update(JSON.stringify(content)).digest('hex')

export function titleKeys(input: TitleInput): Record<string, string> {
	return Object.fromEntries([
		...input.panes.map(pane => [pane.id, key(pane)]),
		...input.tabs.map(tab => [
			tab.id,
			key(tab.panes.map(id => input.panes.find(pane => pane.id === id))),
		]),
	])
}

export function retainedTitles(
	state: SavedState,
	keys: Record<string, string>,
): Titles {
	const isUnchanged = (named: { id: string }): boolean =>
		!!keys[named.id] && keys[named.id] === state.keys[named.id]
	return {
		panes: state.titles.panes.filter(isUnchanged),
		tabs: state.titles.tabs.filter(isUnchanged),
	}
}

export function preserveTitles(generated: Titles, retained: Titles): Titles {
	return {
		panes: generated.panes.map(
			pane => retained.panes.find(prior => prior.id === pane.id) ?? pane,
		),
		tabs: generated.tabs.map(
			tab => retained.tabs.find(prior => prior.id === tab.id) ?? tab,
		),
	}
}
