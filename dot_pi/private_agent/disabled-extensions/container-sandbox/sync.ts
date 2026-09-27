/** The wt sync boundary: the extension's one write verb. wt reconciles the
 * workspace - start, rebuild, devvm add - and every sync adopts the source
 * repo's .pi/container.json onto the recorded settings (--refresh-config), so
 * the container config is always the current file, never the spawn-time
 * snapshot. wt reports each key it adopts and recreates the container only
 * when a container run setting moved. */

import {
	failureReason,
	stringField,
	wtJson,
} from './wt.ts'

import type { SandboxWorkspace } from './wt.ts'

/** One `wt sync --refresh-config`: the failure reason, and what the repo's
 * .pi/container.json changed on this run (empty when the file moved nothing). */
export interface SyncOutcome {
	/** null when the container runs; otherwise the human reason it does not. */
	failure: string | null
	/** Dotted keys the repo's .pi/container.json adopted (`env.VERIFY_REFRESH`). */
	adoptedKeys: string[]
	/** Whether wt recreated the container for a changed container run setting. */
	recreated: boolean
}

/** Start or rebuild the row's container, reporting what the repo's container
 * config changed; the outcome's failure is null on success. */
export async function ensureContainerRunning(
	workspace: SandboxWorkspace,
): Promise<SyncOutcome> {
	if (!(workspace.containerState === 'running'))
		return syncWorkspace(workspace.path)
	return { failure: null, adoptedKeys: [], recreated: false }
}

/**
 * Reconcile a devvm workspace: the idempotent `wt devvm add` behind `wt sync`
 * ensures the VM, the namespace and the relays. There is no state to consult -
 * the add is the state machine.
 */
export async function ensureDevvmRunning(path: string): Promise<SyncOutcome> {
	return syncWorkspace(path)
}

async function syncWorkspace(path: string): Promise<SyncOutcome> {
	try {
		return syncOutcome(
			await wtJson(['sync', path, '--refresh-config', '--json'], path),
		)
	} catch (error) {
		return unexpectedSync(`wt sync failed: ${failureReason(error)}`)
	}
}

/** What `wt sync` reported, mapped to a human reason; null when the container runs. */
function syncOutcome(payload: unknown): SyncOutcome {
	if (typeof payload !== 'object' || payload === null)
		return unexpectedSync('wt sync returned an unexpected reply')
	const report: unknown = Reflect.get(payload, 'sync')
	if (typeof report !== 'object' || report === null)
		return unexpectedSync('wt sync returned no sync report')
	const state = stringField(report, 'container')
	const refresh: unknown = Reflect.get(report, 'refresh')
	const changes =
		typeof refresh === 'object' && refresh !== null
			? readChanges(refresh)
			: []
	const recreated =
		typeof refresh === 'object' &&
		refresh !== null &&
		Reflect.get(refresh, 'recreated') === true
	return {
		failure: failureOf(state),
		adoptedKeys: changes.map(change => change.key),
		recreated,
	}
}

/** null when the container runs; otherwise the human reason it does not. */
function failureOf(state: string | null): string | null {
	if (state === 'running') return null
	return `wt sync left the container ${state ?? 'in an unknown state'}`
}

function unexpectedSync(reason: string): SyncOutcome {
	return { failure: reason, adoptedKeys: [], recreated: false }
}

/** The `sync.refresh.changes` rows: each key the repo's .pi/container.json moved. */
function readChanges(refresh: object): { key: string }[] {
	const changes: unknown = Reflect.get(refresh, 'changes')
	if (!Array.isArray(changes)) return []
	return changes.flatMap(change => {
		if (typeof change !== 'object' || change === null) return []
		const key = stringField(change, 'key')
		return key ? [{ key }] : []
	})
}
