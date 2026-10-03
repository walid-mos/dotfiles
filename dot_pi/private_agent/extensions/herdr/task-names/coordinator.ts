/** The elected Pi session is the only writer of automatic tab names. */
import { createHash } from 'node:crypto'

import { TITLE_LIMIT } from './contracts.ts'
import { publishTask, renameTab, snapshot } from './herdr.ts'
import { retainedTitles, titleKeys } from './stable-titles.ts'
import { consumeAutomatic, saveState } from './storage.ts'
import { summarize } from './summarize.ts'
import { collectTasks, titleInput } from './tasks.ts'

import type { ModelRegistry } from '@earendil-works/pi-coding-agent'
import type { PaneTask, SavedState, Snapshot, Titles } from './contracts.ts'

function fingerprint(tasks: PaneTask[]): string {
	return createHash('sha256')
		.update(JSON.stringify(titleInput(tasks)))
		.digest('hex')
}

async function observeTabs(
	current: Snapshot,
	state: SavedState,
): Promise<SavedState> {
	const tabs = await Promise.all(
		current.tabs.map(async tab => {
			const prior = state.tabs[tab.tab_id]
			const isReset = await consumeAutomatic(tab.tab_id)
			let isManual = prior
				? prior.isManual || prior.observed !== tab.label
				: !/^\d+$/.test(tab.label)
			if (isReset) isManual = false
			return [tab.tab_id, { observed: tab.label, isManual }] as const
		}),
	)
	const next = { ...state, tabs: Object.fromEntries(tabs) }
	await saveState(next)
	return next
}

async function publishPanes(
	tasks: PaneTask[],
	current: Snapshot,
	titles: Titles,
): Promise<void> {
	await Promise.all(
		tasks.map(task => {
			const manual = current.panes.find(
				pane => pane.pane_id === task.id,
			)?.label
			const title =
				manual ||
				titles.panes.find(pane => pane.id === task.id)?.title ||
				task.items[0]?.slice(0, TITLE_LIMIT) ||
				'No declared task'
			return publishTask(task, title)
		}),
	)
}

async function applyTab(
	title: Titles['tabs'][number],
	state: SavedState,
): Promise<SavedState> {
	const tab = state.tabs[title.id]
	if (!tab || tab.isManual || tab.observed === title.title) return state
	// Check immediately before writing, including after a slow model call.
	const latest = await snapshot()
	const observed = latest.tabs.find(
		candidate => candidate.tab_id === title.id,
	)
	if (!observed || observed.label !== tab.observed) return state
	await renameTab(title.id, title.title)
	const next = {
		...state,
		tabs: { ...state.tabs, [title.id]: { ...tab, observed: title.title } },
	}
	await saveState(next)
	return next
}

async function applyTabs(
	current: Snapshot,
	state: SavedState,
): Promise<SavedState> {
	const observed = await observeTabs(current, state)
	const titles = current.tabs.map(
		tab =>
			state.titles.tabs.find(named => named.id === tab.tab_id) ?? {
				id: tab.tab_id,
				title: (
					current.workspaces.find(
						workspace =>
							workspace.workspace_id === tab.workspace_id,
					)?.label || 'No declared task'
				).slice(0, TITLE_LIMIT),
			},
	)
	return titles.reduce(
		async (pending, title) => applyTab(title, await pending),
		Promise.resolve(observed),
	)
}

export async function refreshNames(
	runtime: ModelRegistry,
	state: SavedState,
	signal: AbortSignal,
): Promise<SavedState> {
	const current = await snapshot()
	const tasks = await collectTasks(current)
	const nextFingerprint = fingerprint(tasks)
	const observed = await observeTabs(current, state)
	const hasChanged = nextFingerprint !== observed.fingerprint
	const keys = titleKeys(titleInput(tasks))
	const retained = retainedTitles(observed, keys)
	await publishPanes(tasks, current, retained)
	if (!hasChanged) return applyTabs(current, observed)
	// Remove obsolete task names before waiting on the model or its availability.
	const prepared = await applyTabs(current, {
		...observed,
		fingerprint: '',
		titles: retained,
	})
	const input = titleInput(tasks)
	const titles = input.panes.length
		? await summarize(runtime, input, retained, signal)
		: { panes: [], tabs: [] }
	signal.throwIfAborted()
	const latest = await snapshot()
	const latestTasks = await collectTasks(latest)
	if (fingerprint(latestTasks) !== nextFingerprint) return prepared
	const next = { ...prepared, fingerprint: nextFingerprint, keys, titles }
	await saveState(next)
	await publishPanes(latestTasks, latest, titles)
	return applyTabs(latest, next)
}
