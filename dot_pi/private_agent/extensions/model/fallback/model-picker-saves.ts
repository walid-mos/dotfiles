/**
 * fallback - the picker's saved model choices and what they tell the user.
 *
 * Both write the settings the owning package reads through
 * `model-picker-settings.ts` - one agent's own `model`/`thinking`, or the
 * Ctrl+P list (`enabledModels`: one entry's membership or the whole order) - and
 * neither pretends the running session changed: the subagents package reads a
 * pin at the next launch, and pi re-resolves the saved list on every session
 * start. A
 * refused write reports why and returns false, so the picker keeps the row the
 * user had instead of showing an edit that is not on disk.
 */

import { writeCheckpointModel } from '#lib/context-budget/model.ts'

import {
	settingsPath,
	writeAgentOverride,
	writeDefaultModel,
	writeEnabledModels,
} from './model-picker-settings.ts'

import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type {
	AgentOverrideEdit,
	DefaultModelEdit,
	ScopeListEdit,
} from './model-picker-settings.ts'

function reportFailure(ctx: ExtensionContext, error: unknown): void {
	ctx.ui.notify(
		`fallback: cannot update settings.json: ${String(error)}`,
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

/** Persist the checkpoint model; the next compaction reads this file afresh. */
export function persistCheckpointModel(
	reference: string,
	ctx: ExtensionContext,
	onSaved: () => void,
): boolean {
	try {
		const changed = writeCheckpointModel(reference)
		if (changed) onSaved()
		ctx.ui.notify(
			changed
				? `/context-budget will use ${reference} for its next checkpoint.`
				: `/context-budget already uses ${reference}.`,
			'info',
		)
		return true
	} catch (error) {
		ctx.ui.notify(
			`Cannot update context-budget.json: ${String(error)}`,
			'error',
		)
		return false
	}
}

/**
 * The Ctrl+P list, one edit at a time - a reorder, an addition or a removal.
 * The write is its own feedback: the picker's rows move between the saved and
 * available groups the moment the write lands, and pi re-reads the list on
 * every session start, so a successful edit notifies nothing. A refused write
 * reports why and returns false, so the picker keeps the row the user had
 * instead of showing an edit that is not on disk.
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
