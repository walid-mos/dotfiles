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
	entries: Map<string, SessionEntry>
	leaf: string | null
}
const sessions = new Map<string, SessionIndex>()

async function sessionIndex(file: string): Promise<SessionIndex> {
	const { mtimeMs } = await stat(file)
	const cached = sessions.get(file)
	if (cached?.modified === mtimeMs) return cached
	const parsed = parseSessionEntries(await readFile(file, 'utf8'))
	const entries = parsed.filter(
		(entry): entry is SessionEntry => entry.type !== 'session',
	)
	const index = {
		modified: mtimeMs,
		entries: new Map(entries.map(entry => [entry.id, entry])),
		leaf: entries.at(-1)?.id ?? null,
	}
	sessions.set(file, index)
	return index
}

async function branch(file: string, paneId: string): Promise<SessionEntry[]> {
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
	const selection = await optionalJson(selectionPath(paneId))
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

async function paneTask(pane: Pane, snapshot: Snapshot): Promise<PaneTask[]> {
	const session = pane.agent_session
	if (pane.agent !== 'pi') return []
	const isNative = session?.source === 'herdr:pi' && session.kind === 'path'
	const goal = isNative
		? activeGoal(await branch(session.value, pane.pane_id))
		: undefined
	const items =
		goal?.items.filter(goalItem => goalItem.kind !== 'request') ?? []
	return [
		{
			id: pane.pane_id,
			tabId: pane.tab_id,
			session: isNative ? session.value : '',
			project:
				snapshot.workspaces.find(
					workspace => workspace.workspace_id === pane.workspace_id,
				)?.label ?? path.basename(pane.cwd ?? 'Pi'),
			items: items.map(goalItem => goalItem.text),
			isComplete:
				!!goal?.items.length &&
				goal.items.every(goalItem => goalItem.done),
		},
	]
}

export async function collectTasks(snapshot: Snapshot): Promise<PaneTask[]> {
	const tasks = (
		await Promise.all(snapshot.panes.map(pane => paneTask(pane, snapshot)))
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
