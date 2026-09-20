/**
 * goal-gate - the `goal` tool: the bookkeeping the agent does on its own
 * checklist, so the ledger is written by a call instead of by hand-editing a
 * file it was told about.
 *
 * It touches the same ledger the settle gate reads, through the store the
 * caller injects: declaring adds the deliverables, ticking closes one with its
 * outcome, blocking records the decision the run is stopped on. The tool never
 * decides anything about settling - `gate.ts` does, from the file this writes.
 *
 * Module: `ledger-edits.ts` holds the pure rules (what each call produces);
 * this file is the pi-facing half - schema, wording, dispatch.
 */

import { StringEnum } from '@earendil-works/pi-ai'
import { Type } from 'typebox'

import { blockLedger, declareItems, tickItem } from './ledger-edits.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { Static } from 'typebox'
import type { LedgerStatus } from './ledger.ts'

const TOOL_NAME = 'goal'

const TOOL_DESCRIPTION = `Keep this run's goal checklist - the ledger a settled run is held to: a run that ends with an item open is continued.

- declare: the deliverables, before the work starts; appends, skipping items already on the list.
- tick: close one item the moment it lands, with its outcome - what landed and where (commit, file, PR), since a later session reads that instead of re-deriving the work.
- block: you are stopped on a decision only the human can make; record it, raise it with ask_user_question, then stop.`

const toolParameters = Type.Object({
	action: StringEnum(['declare', 'tick', 'block'] as const, {
		description: 'What this call does to the checklist.',
	}),
	items: Type.Optional(
		Type.Array(Type.String(), {
			description:
				'declare: one entry per deliverable, in the order they will be worked through.',
		}),
	),
	item: Type.Optional(
		Type.String({
			description: 'tick: the text of the item to close, as declared.',
		}),
	),
	outcome: Type.Optional(
		Type.String({
			description:
				'tick: what landed and where (commit, file, PR) - the ledger keeps it.',
		}),
	),
	reason: Type.Optional(
		Type.String({
			description:
				'block: the decision you need from the human, naming the follow-up it unblocks.',
		}),
	),
})

type GoalParams = Static<typeof toolParameters>

/** Where this session's ledger lives, and how to read and write it. */
export type LedgerStore = {
	path: () => string | undefined
	read: (path: string) => string | undefined
	write: (path: string, text: string) => void
	/** New work landed on the checklist: a closed cycle is guarded again. */
	reopen: () => void
}

/** A field the call left empty; the ledger records nothing for a blank value. */
function requireField(
	suppliedText: string | undefined,
	field: string,
	use: string,
): string {
	const trimmed = suppliedText?.trim()
	if (trimmed) return trimmed
	throw new Error(
		`goal ${use} needs \`${field}\` - an empty one records nothing.`,
	)
}

function requireItems(items: string[] | undefined): string[] {
	const declared = (items ?? []).filter(entry => entry.trim())
	if (declared.length) return declared
	throw new Error(
		'goal declare needs `items`: one entry per deliverable, at least one.',
	)
}

/** The items still open, for a result that has to say what is left. */
function openSuffix(status: LedgerStatus): string {
	if (!status.open.length) return ''
	return ` Still open: ${status.open.map(openItem => `"${openItem}"`).join(', ')}.`
}

/**
 * Why nothing matched, for a failed tick. A result claiming nothing was ever
 * declared, on a checklist whose items are simply all checked, sends the caller
 * looking for the wrong problem.
 */
function checklistState(status: LedgerStatus): string {
	if (status.items.length)
		return status.open.length
			? openSuffix(status)
			: ' Every declared item is already checked - declare the new work first.'
	return ' The checklist has no items yet - declare them first.'
}

/** One call onto the ledger, returning what to tell the model. */
function apply(
	params: GoalParams,
	text: string | undefined,
	path: string,
	store: LedgerStore,
): string {
	if (params.action === 'declare') {
		const declaration = declareItems(text, requireItems(params.items))
		if (!declaration.added.length)
			return `Every declared item is already on the checklist (${declaration.skipped.length} skipped).`
		store.write(path, declaration.text)
		// Work declared after the cycle closed (all items ticked, or the budget
		// spent) is a new cycle: without this the gate would ignore it until the
		// next human prompt.
		store.reopen()
		const skipped = declaration.skipped.length
			? ` (${declaration.skipped.length} already there, skipped)`
			: ''
		const added = declaration.added.map(entry => `"${entry}"`).join(', ')
		return `Declared ${declaration.added.length} item(s)${skipped}: ${added}.`
	}
	if (params.action === 'tick') {
		const declaredItem = requireField(params.item, 'item', 'tick')
		const outcome = requireField(params.outcome, 'outcome', 'tick')
		const tick = tickItem(text ?? '', declaredItem, outcome)
		if (tick.type === 'unknown')
			throw new Error(
				`goal tick: no open item matches "${declaredItem}".${checklistState(tick.status)}`,
			)
		if (tick.type === 'ticked') store.write(path, tick.text)
		const checked = tick.status.items.filter(entry => entry.done).length
		const verb = tick.type === 'ticked' ? 'Ticked' : 'Already ticked'
		return `${verb}: "${declaredItem}". ${checked} of ${tick.status.items.length} items checked.${openSuffix(tick.status)}`
	}
	const reason = requireField(params.reason, 'reason', 'block')
	store.write(path, blockLedger(text, reason))
	return `Blocked recorded: ${reason}\nRaise it with ask_user_question now, naming the follow-up, then stop.`
}

export function registerGoalTool(pi: ExtensionAPI, store: LedgerStore): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: 'Goal',
		description: TOOL_DESCRIPTION,
		promptSnippet: "Declare or tick this run's goal checklist",
		parameters: toolParameters,
		execute: async (_toolCallId, params: GoalParams) => {
			const path = store.path()
			if (!path)
				throw new Error(
					'goal: this session has no checklist yet - it is armed at session start.',
				)
			return {
				content: [
					{
						type: 'text' as const,
						text: apply(params, store.read(path), path, store),
					},
				],
				details: { action: params.action, path },
			}
		},
	})
}
