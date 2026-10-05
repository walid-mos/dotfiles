/** The elected Pi session writes current names without waiting for the model. */
import { createHash } from 'node:crypto'

import { publishTask, renameTab, snapshot } from './herdr.ts'
import { currentTitles, retainedTitles, titleKeys } from './stable-titles.ts'
import { consumeAutomatic, saveState } from './storage.ts'
import { collectTasks, titleInput } from './tasks.ts'

import type { PaneTask, SavedState, Snapshot, Titles } from './contracts.ts'
import type { TitleInput } from './tasks.ts'

export type NamingPlan = {
	fingerprint: string
	keys: SavedState['keys']
	input: TitleInput
	retained: Titles
}
export type NamedPlan = Pick<NamingPlan, 'fingerprint' | 'keys'> & {
	titles: Titles
}

async function observeTabs(
	current: Snapshot,
	state: SavedState,
): Promise<SavedState> {
	const tabs = await Promise.all(
		current.tabs.map(async tab => {
			const prior = state.tabs[tab.tab_id]
			const isReset = await consumeAutomatic(tab.tab_id)
			const isManual =
				!isReset &&
				(prior
					? prior.isManual || prior.observed !== tab.label
					: !/^\d+$/.test(tab.label))
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
	onFailure: (message: string) => void,
): Promise<void> {
	await Promise.all(
		tasks.map(async task => {
			const manual = current.panes.find(
				pane => pane.pane_id === task.id,
			)?.label
			const title =
				manual || titles.panes.find(pane => pane.id === task.id)?.title
			if (!title) throw new Error(`No current title for ${task.id}`)
			try {
				await publishTask(task, title)
			} catch (cause) {
				onFailure(`Cannot publish ${task.id} task: ${String(cause)}`)
			}
		}),
	)
}

async function applyTab(
	title: Titles['tabs'][number],
	state: SavedState,
): Promise<SavedState> {
	const tab = state.tabs[title.id]
	if (!tab || tab.isManual || tab.observed === title.title) return state
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
	titles: Titles,
	state: SavedState,
	onFailure: (message: string) => void,
): Promise<void> {
	await titles.tabs.reduce(async (pending, title) => {
		const observed = await pending
		try {
			return await applyTab(title, observed)
		} catch (cause) {
			onFailure(`Cannot name ${title.id} tab: ${String(cause)}`)
			return observed
		}
	}, Promise.resolve(state))
}

export async function refreshNames(
	state: SavedState,
	generated: NamedPlan | undefined,
	onFailure: (message: string) => void,
): Promise<NamingPlan | undefined> {
	const current = await snapshot()
	const tasks = await collectTasks(current, onFailure)
	const input = titleInput(tasks)
	const fingerprint = createHash('sha256')
		.update(JSON.stringify(input))
		.digest('hex')
	const keys = titleKeys(input)
	const named =
		generated?.fingerprint === fingerprint
			? { ...state, ...generated }
			: state
	const observed = await observeTabs(current, named)
	const retained = retainedTitles(observed, keys)
	const titles = currentTitles(tasks, current, retained)
	await publishPanes(tasks, current, titles, onFailure)
	await applyTabs(titles, observed, onFailure)
	if (!input.panes.length || fingerprint === observed.fingerprint)
		return undefined
	return { input, fingerprint, keys, retained }
}
