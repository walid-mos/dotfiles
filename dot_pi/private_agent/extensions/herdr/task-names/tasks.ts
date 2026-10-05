/** Reads only live Pi sessions. Transcript text never enters the naming request. */
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { parseSessionEntries } from '@earendil-works/pi-coding-agent'
import { Value } from 'typebox/value'

import { activeGoal } from '#lib/goal/state.ts'

import { BranchSelection } from './contracts.ts'
import { optionalJson, selectionPath } from './storage.ts'

import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import type { Pane, PaneTask, Snapshot } from './contracts.ts'

export interface TitleInput {
	panes: { id: string; project: string; tasks: string[] }[]
	tabs: { id: string; panes: string[] }[]
}

interface SessionIndex {
	modified: number
	size: number
	entries: Map<string, SessionEntry>
	leaf: string | null
}
const sessions = new Map<string, SessionIndex>()

async function sessionIndex(file: string): Promise<SessionIndex> {
	const { mtimeMs, size } = await stat(file)
	const cached = sessions.get(file)
	if (cached?.modified === mtimeMs && cached.size === size) return cached
	const parsed = parseSessionEntries(await readFile(file, 'utf8'))
	const entries = parsed.filter(
		(entry): entry is SessionEntry => entry.type !== 'session',
	)
	const index = {
		modified: mtimeMs,
		size,
		entries: new Map(entries.map(entry => [entry.id, entry])),
		leaf: entries.at(-1)?.id ?? null,
	}
	sessions.set(file, index)
	return index
}

async function branch(file: string, paneId: string): Promise<SessionEntry[]> {
	// Read the branch pointer first: it must not advance past the file we read.
	const selection = await optionalJson(selectionPath(paneId))
	let index: SessionIndex
	try {
		index = await sessionIndex(file)
	} catch (cause) {
		// Pi reports a new session before its first message creates the file.
		if (
			cause &&
			typeof cause === 'object' &&
			Reflect.get(cause, 'code') === 'ENOENT'
		)
			return []
		throw cause
	}
	const selectedLeaf =
		Value.Check(BranchSelection, selection) && selection.session === file
			? selection.leaf
			: index.leaf
	const entries: SessionEntry[] = []
	let leaf = selectedLeaf
	const visited = new Set<string>()
	while (leaf) {
		if (visited.has(leaf)) throw new Error(`Cycle in Pi session ${file}`)
		visited.add(leaf)
		const entry = index.entries.get(leaf)
		if (!entry)
			throw new Error(`Missing Pi branch entry ${leaf} in ${file}`)
		entries.push(entry)
		leaf = entry.parentId
	}
	return entries.toReversed()
}

async function paneTask(
	pane: Pane,
	snapshot: Snapshot,
	onFailure: (message: string) => void,
): Promise<PaneTask[]> {
	const session = pane.agent_session
	if (pane.agent !== 'pi') return []
	const isNative = session?.source === 'herdr:pi' && session.kind === 'path'
	const task: PaneTask = {
		id: pane.pane_id,
		tabId: pane.tab_id,
		session: isNative ? session.value : '',
		project:
			snapshot.workspaces.find(
				workspace => workspace.workspace_id === pane.workspace_id,
			)?.label ||
			path.basename(pane.cwd ?? 'Pi') ||
			'Pi',
		items: [],
		isComplete: false,
		isReadable: true,
	}
	if (!isNative) return [task]
	try {
		const goal = activeGoal(await branch(session.value, pane.pane_id))
		return [
			{
				...task,
				items: (
					goal?.items.filter(
						goalItem => goalItem.kind !== 'request',
					) ?? []
				).map(goalItem => goalItem.text),
				isComplete:
					!!goal?.items.length &&
					goal.items.every(goalItem => goalItem.done),
			},
		]
	} catch (cause) {
		onFailure(`Cannot read ${pane.pane_id} task: ${String(cause)}`)
		return [{ ...task, isReadable: false }]
	}
}

export async function collectTasks(
	snapshot: Snapshot,
	onFailure: (message: string) => void,
): Promise<PaneTask[]> {
	const tasks = (
		await Promise.all(
			snapshot.panes.map(pane => paneTask(pane, snapshot, onFailure)),
		)
	).flat()
	const liveFiles = new Set(tasks.map(task => task.session))
	for (const file of sessions.keys())
		if (!liveFiles.has(file)) sessions.delete(file)
	return tasks.toSorted((left, right) => left.id.localeCompare(right.id))
}

/** Completed panes matter only when no declared task in that tab remains open. */
export function titleInput(tasks: PaneTask[]): TitleInput {
	const declared = tasks.filter(task => task.items.length)
	const tabs = [...new Set(declared.map(task => task.tabId))]
		.toSorted()
		.map(id => {
			const members = declared.filter(task => task.tabId === id)
			const active = members.filter(task => !task.isComplete)
			return {
				id,
				panes: (active.length ? active : members).map(task => task.id),
			}
		})
	return {
		panes: declared.map(({ id, project, items }) => ({
			id,
			project,
			tasks: items,
		})),
		tabs,
	}
}
