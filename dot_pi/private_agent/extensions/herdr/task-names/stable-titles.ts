/** Unchanged declared work keeps its exact title when another pane changes. */
import { createHash } from 'node:crypto'

import { titleInput } from './tasks.ts'
import { titleText } from './title-text.ts'

import type { PaneTask, SavedState, Snapshot, Titles } from './contracts.ts'
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

/** Current declared text is immediately usable while model naming runs. */
export function currentTitles(
	tasks: PaneTask[],
	snapshot: Snapshot,
	retained: Titles,
): Titles {
	const panes = tasks.map(task => ({
		id: task.id,
		title:
			retained.panes.find(named => named.id === task.id)?.title ??
			titleText(
				task.isReadable
					? task.items[0] || task.project
					: 'Session unavailable',
			),
	}))
	const groups = titleInput(tasks).tabs
	const tabs = snapshot.tabs.map(tab => {
		const members =
			groups.find(group => group.id === tab.tab_id)?.panes ??
			tasks.filter(task => task.tabId === tab.tab_id).map(task => task.id)
		const subjects = members.map(
			id => panes.find(pane => pane.id === id)?.title,
		)
		const project = snapshot.workspaces.find(
			workspace => workspace.workspace_id === tab.workspace_id,
		)?.label
		return {
			id: tab.tab_id,
			title:
				retained.tabs.find(named => named.id === tab.tab_id)?.title ??
				titleText(
					[...new Set(subjects.filter(Boolean))].join(' · ') ||
						project ||
						'Pi',
				),
		}
	})
	return { panes, tabs }
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
