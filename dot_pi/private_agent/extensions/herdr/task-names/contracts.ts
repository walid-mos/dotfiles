/** Validated Herdr responses and persisted task-naming state. */
import { Type } from 'typebox'

import type { Static } from 'typebox'

export const POLL_MS = 5_000
export const METADATA_TTL_MS = 300_000
export const TITLE_LIMIT = 48
export const SOURCE = 'pi-task-names'
export const Title = Type.String({
	minLength: 1,
	maxLength: TITLE_LIMIT,
	pattern: '^[^\\r\\n\\x00-\\x1f\\x7f]+$',
})
const Pane = Type.Object({
	pane_id: Type.String(),
	tab_id: Type.String(),
	workspace_id: Type.String(),
	cwd: Type.Optional(Type.String()),
	label: Type.Optional(Type.String()),
	agent: Type.Optional(Type.String()),
	agent_session: Type.Optional(
		Type.Object({
			source: Type.String(),
			kind: Type.String(),
			value: Type.String(),
		}),
	),
})
export const Snapshot = Type.Object({
	panes: Type.Array(Pane),
	tabs: Type.Array(
		Type.Object({
			tab_id: Type.String(),
			workspace_id: Type.String(),
			label: Type.String(),
		}),
	),
	workspaces: Type.Array(
		Type.Object({ workspace_id: Type.String(), label: Type.String() }),
	),
})
export const SnapshotResponse = Type.Object({
	result: Type.Object({ snapshot: Snapshot }),
})
export type Snapshot = Static<typeof Snapshot>
export type Pane = Static<typeof Pane>
export const Titles = Type.Object({
	panes: Type.Array(Type.Object({ id: Type.String(), title: Title })),
	tabs: Type.Array(Type.Object({ id: Type.String(), title: Title })),
})
export type Titles = Static<typeof Titles>
export const TabState = Type.Object({
	observed: Type.String(),
	isManual: Type.Boolean(),
})
export const SavedState = Type.Object({
	tabs: Type.Record(Type.String(), TabState),
	fingerprint: Type.String(),
	keys: Type.Record(Type.String(), Type.String()),
	titles: Titles,
})
export type SavedState = Static<typeof SavedState>
export interface PaneTask {
	id: string
	tabId: string
	project: string
	session: string
	items: string[]
	isComplete: boolean
}
export const BranchSelection = Type.Object({
	session: Type.String(),
	leaf: Type.Union([Type.String(), Type.Null()]),
})
