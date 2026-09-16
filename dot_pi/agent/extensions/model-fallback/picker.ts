/**
 * model-fallback - the unified model surface: `/models` (alias `/fallback`).
 *
 * One picker covers the session model and its reasoning level, the scope this
 * session resolved, the ordered fallback chain with its toggles, and what the
 * agent pins point at. The scope is shown and explained, not edited; per-agent
 * models are edited inline (the same catalogue search plus thinking levels),
 * written to exactly that agent's `model` and `thinking` in the settings the
 * `subagents` package owns at launch - `/subagents` stays the advanced surface,
 * dispatched only after this picker has released the editor, which is why that
 * handoff lands instead of being overwritten by the picker's own next prompt.
 * Escape goes back one level at a time: search, open editor, a row action just
 * committed, then the picker itself.
 *
 * `formatFallbackStatus` renders the plain-text `/fallback status` line.
 */

import { modelReference } from './chain.ts'
import { catalogRows } from './model-catalog.ts'
import { ModelPickerComponent } from './model-picker-component.ts'
import {
	readSettingsSnapshot,
	settingsPath,
	writeAgentOverride,
} from './model-picker-settings.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { ModelFallbackConfig } from './config.ts'
import type { AgentOverrideEdit } from './model-picker-settings.ts'
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

const MS_PER_SECOND = 1_000
const SUBAGENTS_COMMAND = 'subagents'
const SESSION_TARGET = 'Session model'

/** Command names pi knows, without the `name:2` suffix pi adds on collisions. */
function registeredCommandNames(pi: ExtensionAPI): Set<string> {
	const names = new Set<string>()
	for (const command of pi.getCommands()) {
		names.add(command.name.split(':')[0] ?? command.name)
	}
	return names
}

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
		patterns: settings.patterns,
		isSettingsReadable: settings.isReadable,
		pricing: deps.pricing.snapshot(),
		config: deps.getConfig(),
		agentPins: settings.agentPins,
		hasSubagentsCommand: registeredCommandNames(deps.pi).has(
			SUBAGENTS_COMMAND,
		),
		cooldowns: deps.getCooldowns(),
		now: Date.now(),
	}
}

/**
 * The `subagents` command is the package's own admin surface; this extension
 * only opens it. The dispatch happens after `ctx.ui.custom` resolved - the
 * picker no longer holds the editor - and nothing opens a second modal behind
 * it, which is what made the previous menu look dead.
 */
function openAgentAdmin(deps: PickerDeps): void {
	deps.pi.sendUserMessage(`/${SUBAGENTS_COMMAND}`, {
		expandPromptTemplates: true,
	})
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
			`model-fallback: ${outcome.reference} is no longer available.`,
			'error',
		)
		return
	}
	if (!(await deps.pi.setModel(row.model))) {
		ctx.ui.notify(
			`model-fallback: no credentials configured for ${outcome.reference}.`,
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
 * One agent's pin, written where the subagents package reads it: that package
 * re-reads settings.json on every launch (its discovery cache is invalidated by
 * the file's own size and mtime), so the next launch of this agent uses the
 * model - a subagent already running keeps the one it started with.
 */
function persistAgentOverride(
	edit: AgentOverrideEdit,
	ctx: ExtensionContext,
	onSaved: () => void,
): boolean {
	try {
		writeAgentOverride(settingsPath(), edit)
	} catch (error) {
		ctx.ui.notify(
			`model-fallback: cannot update settings.json: ${String(error)}`,
			'error',
		)
		return false
	}
	onSaved()
	const level = edit.thinking ? ` · thinking ${edit.thinking}` : ''
	ctx.ui.notify(
		`${edit.agent} now pins ${edit.model}${level} - the next launch uses it; a running subagent keeps its model.`,
		'info',
	)
	return true
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
				persistAgentOverride(edit, ctx, () =>
					writeView({
						...readView(),
						agentPins: readSettingsSnapshot().agentPins,
					}),
				),
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
	if (!outcome || outcome.kind === 'cancel') return
	if (outcome.kind === 'model')
		return applyModelChoice(ctx, deps, outcome, view)
	if (!view.hasSubagentsCommand) {
		ctx.ui.notify(
			'model-fallback: the subagents package is not loaded; per-agent models stay with it.',
			'warning',
		)
		return
	}
	openAgentAdmin(deps)
}

export async function openModelPicker(
	ctx: ExtensionContext,
	deps: PickerDeps,
): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify(
			'model-fallback: /models needs an interactive session.',
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

function coolingDownNotes(
	exclusions: ReadonlyMap<string, number>,
	now: number,
): string[] {
	const cooling = [...exclusions]
		.filter(([, until]) => until > now)
		.map(
			([reference, until]) =>
				`${reference} (${Math.ceil((until - now) / MS_PER_SECOND)}s)`,
		)
	if (!cooling.length) return []
	return [`Cooling down: ${cooling.join(', ')}`]
}

export function formatFallbackStatus(
	config: ModelFallbackConfig,
	currentModel: string | undefined,
	exclusions: ReadonlyMap<string, number>,
	now: number,
): string {
	return [
		`Auto-fallback: ${config.autoFallback ? 'ON' : 'OFF'}   restore on a clean turn: ${config.restoreOnSuccess ? 'ON' : 'OFF'}   abort on 5xx: ${config.fastFailover ? 'ON' : 'OFF'}`,
		`Main model: ${currentModel ?? 'unknown'} (subagents inheriting the session use it)`,
		`Chain: ${config.chain.join(' → ') || 'empty - run /fallback to add models'}`,
		...coolingDownNotes(exclusions, now),
	].join('\n')
}
