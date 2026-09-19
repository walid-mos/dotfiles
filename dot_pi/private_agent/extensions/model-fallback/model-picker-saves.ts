/**
 * model-fallback - the picker's two saves and what they tell the user.
 *
 * Both write the settings the owning package reads through
 * `model-picker-settings.ts` - one agent's own `model`/`thinking`, or the
 * Ctrl+P list (`enabledModels`: one entry's membership or the whole order) - and
 * neither pretends the running session changed: the subagents package reads a
 * pin at the next launch, and pi resolves the list at session start. A
 * refused write reports why and returns false, so the picker keeps the row the
 * user had instead of showing an edit that is not on disk.
 */

import {
	settingsPath,
	writeAgentOverride,
	writeDefaultModel,
	writeEnabledModels,
} from './model-picker-settings.ts'
import { CTRL_P_LIST } from './model-picker-words.ts'

import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type {
	AgentOverrideEdit,
	DefaultModelEdit,
	ScopeListEdit,
} from './model-picker-settings.ts'

function reportFailure(ctx: ExtensionContext, error: unknown): void {
	ctx.ui.notify(
		`model-fallback: cannot update settings.json: ${String(error)}`,
		'error',
	)
}

/**
 * One agent's pin, written where the subagents package reads it: that package
 * re-reads settings.json on every launch (its discovery cache is invalidated by
 * the file's own size and mtime), so the next launch of this agent uses it - a
 * subagent already running keeps the one it started with.
 */
export function persistAgentOverride(
	edit: AgentOverrideEdit,
	ctx: ExtensionContext,
	onSaved: () => void,
): boolean {
	try {
		writeAgentOverride(settingsPath(), edit)
	} catch (error) {
		reportFailure(ctx, error)
		return false
	}
	onSaved()
	const level = edit.thinking ? ` · thinking ${edit.thinking}` : ''
	// A reasoning-only edit (the agents tab) never claims to pin a model.
	const what = edit.model
		? `now pins ${edit.model}${level}`
		: `now runs thinking ${String(edit.thinking)}`
	ctx.ui.notify(
		`${edit.agent} ${what} - the next launch uses it; a running subagent keeps its model.`,
		'info',
	)
	return true
}

/** What one list edit did, said the way the user sees it. */
function scopeChangeText(edit: ScopeListEdit): string {
	const count = `${String(edit.next.length)} ${edit.next.length === 1 ? 'entry' : 'entries'}`
	if (edit.change.kind === 'reordered')
		return `${CTRL_P_LIST} order saved (${count})`
	const verb =
		edit.change.kind === 'added'
			? `added to the ${CTRL_P_LIST}`
			: `removed from the ${CTRL_P_LIST}`
	return `${edit.change.entry} ${verb} (${count})`
}

/**
 * The Ctrl+P list, one edit at a time - a reorder, an addition or a removal.
 * The running session keeps the list pi resolved at its own start:
 * `ctx.scopedModels` is a read-only snapshot and no extension API can move it,
 * so the notice states when the edit applies instead of pretending this
 * session's cycle changed.
 */
export function persistScopeList(
	edit: ScopeListEdit,
	ctx: ExtensionContext,
	onSaved: () => void,
): boolean {
	try {
		writeEnabledModels(settingsPath(), edit)
	} catch (error) {
		reportFailure(ctx, error)
		return false
	}
	onSaved()
	ctx.ui.notify(
		`${scopeChangeText(edit)} - this session keeps the list it started with; pi applies the edit at the next session start.`,
		'info',
	)
	return true
}

/**
 * The startup default: what a new session starts on, written to pi's own
 * `defaultProvider`/`defaultModel`. It deliberately says *new* sessions: the
 * running one keeps the model it is on (its choice is the session's, and the
 * picker's own enter is what changes that).
 */
export function persistDefaultModel(
	edit: DefaultModelEdit,
	ctx: ExtensionContext,
): boolean {
	try {
		const changed = writeDefaultModel(settingsPath(), edit)
		ctx.ui.notify(
			changed
				? `${edit.reference} is now the startup default for new sessions.`
				: `${edit.reference} already is the startup default.`,
			'info',
		)
		return true
	} catch (error) {
		reportFailure(ctx, error)
		return false
	}
}
