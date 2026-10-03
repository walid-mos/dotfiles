/**
 * fallback - the unified model surface: `/models`.
 *
 * One picker covers the session model and its reasoning level, the Ctrl+P list
 * entries and their order, the ordered fallback chain with its toggles, and what
 * the agent pins point at. The Ctrl+P list is written to `enabledModels`
 * as its order or membership changes, with the tab saying when pi reads it (on
 * every session start, /new included: a running session keeps the list it
 * resolved, no extension API can move it, and no pi relaunch is ever needed);
 * per-agent models and thinking levels are edited inline (the models the Ctrl+P list names, with pi's own levels), written to exactly
 * that agent's `model`/`thinking` in the settings the `subagents` package owns
 * at launch. The separate checkpoint row writes context-budget.json. Escape
 * goes back one level at a time:
 * search, open editor, a row action just committed, then the picker itself.
 */

import { readCheckpointModel } from '#lib/context-budget/model.ts'

import { readAgentRoster } from './agent-roster.ts'
import { modelReference } from './chain.ts'
import { catalogRows } from './model-catalog.ts'
import { ModelPickerComponent } from './model-picker-component.ts'
import {
	persistAgentOverride,
	persistCheckpointModel,
	persistDefaultModel,
	persistScopeList,
} from './model-picker-saves.ts'
import { readSettingsSnapshot } from './model-picker-settings.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { ModelFallbackConfig } from './config.ts'
import type { PickerOutcome } from './model-picker-state.ts'
import type { PickerView, ScopeEntry } from './model-picker-view.ts'
import type {
	OpenRouterPricing,
	OpenRouterPricingSource,
} from './openrouter-pricing.ts'

export interface PickerDeps {
	pi: ExtensionAPI
	getConfig: () => ModelFallbackConfig
	setConfig: (config: ModelFallbackConfig) => void
	/** Models this extension is holding out of the chain right now. */
	getCooldowns: () => ReadonlyMap<string, number>
	/** The session's live OpenRouter price list; read here, fetched by its owner. */
	pricing: OpenRouterPricingSource
}

const SESSION_TARGET = 'Session model'

function scopeEntries(ctx: ExtensionContext): ScopeEntry[] {
	const currentReference = ctx.model ? modelReference(ctx.model) : undefined
	return ctx.scopedModels.map(entry => {
		const reference = modelReference(entry.model)
		return {
			reference,
			level: entry.thinkingLevel,
			isCurrent: reference === currentReference,
		}
	})
}

/** Everything the picker renders, read once: rendering performs no IO. */
function pickerView(ctx: ExtensionContext, deps: PickerDeps): PickerView {
	const settings = readSettingsSnapshot()
	// The `subagents` package owns agent discovery: it answers the roster over
	// pi's event bus in the same process, and `undefined` means it did not
	// (not installed, older version, or an answer this reader refuses).
	const roster = readAgentRoster(deps.pi, ctx.cwd, ctx.model?.provider)
	return {
		rows: catalogRows({
			available: ctx.modelRegistry.getAvailable(),
			scoped: ctx.scopedModels,
			current: ctx.model,
		}),
		currentReference: ctx.model ? modelReference(ctx.model) : undefined,
		sessionLevel: ctx.thinkingLevel,
		scope: scopeEntries(ctx),
		isScopeUnrestricted: !ctx.scopedModels.length,
		startupDefault: settings.startupDefault,
		patterns: settings.patterns,
		isSettingsReadable: settings.isReadable,
		pricing: deps.pricing.snapshot(),
		config: deps.getConfig(),
		agentPins: settings.agentPins,
		areAgentPinsKnown: settings.areAgentPinsKnown,
		roster: roster?.agents,
		checkpointModel: readCheckpointModel(),
		cooldowns: deps.getCooldowns(),
		now: Date.now(),
	}
}

async function applyModelChoice(
	ctx: ExtensionContext,
	deps: PickerDeps,
	outcome: Extract<PickerOutcome, { kind: 'model' }>,
	view: PickerView,
): Promise<void> {
	const row = view.rows.find(
		candidate => candidate.reference === outcome.reference,
	)
	if (!row) {
		ctx.ui.notify(
			`fallback: ${outcome.reference} is no longer available.`,
			'error',
		)
		return
	}
	if (!(await deps.pi.setModel(row.model))) {
		ctx.ui.notify(
			`fallback: no credentials configured for ${outcome.reference}.`,
			'error',
		)
		return
	}
	const appliedLevel = outcome.level ? ` · thinking ${outcome.level}` : ''
	ctx.ui.notify(
		`${SESSION_TARGET} ${outcome.reference}${appliedLevel} (agents that inherit it follow; pinned agents do not).`,
		'info',
	)
	// Apply what the row showed for *that* model: switching can clamp or
	// re-derive the session level, so comparing against the old one is not
	// enough, and a scope pattern's pinned level must take effect too. The
	// picker only ever shows a level this model accepts.
	if (outcome.level) deps.pi.setThinkingLevel(outcome.level)
}
/**
 * The live list lands after the picker opened: the catalog readings hold until
 * then, and `onPriced` updates the view the mounted picker renders from.
 */
async function readLivePrices(
	deps: PickerDeps,
	onPriced: (pricing: OpenRouterPricing) => void,
): Promise<void> {
	const pricing = await deps.pricing.refresh()
	if (pricing) onPriced(pricing)
}

/**
 * Mount the picker over one live view: config edits, agent pins and the live
 * price list all flow through this one place, so a repaint never re-reads the
 * session.
 */
function mountPicker(input: {
	ctx: ExtensionContext
	deps: PickerDeps
	readView: () => PickerView
	writeView: (next: PickerView) => void
	onRepaintReady: (repaint: () => void) => void
}): Promise<PickerOutcome | undefined> {
	const { ctx, deps, readView, writeView, onRepaintReady } = input
	return ctx.ui.custom<PickerOutcome>((tui, _theme, _keybindings, done) => {
		const picker = new ModelPickerComponent({
			view: readView,
			height: () => tui.terminal.rows,
			onRender: () => tui.requestRender(),
			onConfigChange: next => {
				writeView({ ...readView(), config: next })
				deps.setConfig(next)
			},
			onAgentOverrideChange: edit =>
				persistAgentOverride(edit, ctx, () => {
					const next = readSettingsSnapshot()
					writeView({
						...readView(),
						agentPins: next.agentPins,
						areAgentPinsKnown: next.areAgentPinsKnown,
						roster: readAgentRoster(
							deps.pi,
							ctx.cwd,
							ctx.model?.provider,
						)?.agents,
					})
				}),
			onCheckpointModelChange: reference =>
				persistCheckpointModel(reference, ctx, () =>
					writeView({ ...readView(), checkpointModel: reference }),
				),
			onScopeListChange: edit =>
				persistScopeList(edit, ctx, () =>
					writeView({ ...readView(), patterns: edit.next }),
				),
			onDefaultModelChange: edit => persistDefaultModel(edit, ctx),
			onDone: done,
		})
		onRepaintReady(() => {
			picker.invalidate()
			tui.requestRender()
		})
		return picker
	})
}

/** What the picker resolved into, once its modal has been released. */
async function completePicker(
	outcome: PickerOutcome | undefined,
	ctx: ExtensionContext,
	deps: PickerDeps,
	view: PickerView,
): Promise<void> {
	if (outcome?.kind === 'model')
		await applyModelChoice(ctx, deps, outcome, view)
}

export async function openModelPicker(
	ctx: ExtensionContext,
	deps: PickerDeps,
): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify(
			'fallback: /models needs an interactive session.',
			'warning',
		)
		return
	}
	let view = pickerView(ctx, deps)
	let repaintPicker: (() => void) | undefined
	// The picker opens immediately; a failed live read simply leaves the view
	// on the catalog reading.
	void readLivePrices(deps, pricing => {
		view = { ...view, pricing, now: Date.now() }
		repaintPicker?.()
	})
	const outcome = await mountPicker({
		ctx,
		deps,
		readView: () => view,
		writeView: next => {
			view = next
		},
		onRepaintReady: repaint => {
			repaintPicker = repaint
		},
	})
	repaintPicker = undefined
	await completePicker(outcome, ctx, deps, view)
}
