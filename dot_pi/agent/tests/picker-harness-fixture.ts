/**
 * The pi/ctx double the picker tests drive.
 *
 * The picker talks to pi through four seams - `ctx.ui.custom`, the model
 * registry, `pi.setModel`/`setThinkingLevel` and `pi.sendUserMessage` - so the
 * double implements exactly those and records what crossed them. Rendering goes
 * through the component the picker mounted, at whatever terminal size a test
 * asks for, so width contracts are checked against real layout output.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as tick } from 'node:timers/promises'

import { defaultConfig } from '../extensions/model-fallback/config.ts'
import { createOpenRouterPricingSource } from '../extensions/model-fallback/openrouter-pricing.ts'
import { openModelPicker } from '../extensions/model-fallback/picker.ts'

import { createComponentHost, double } from './picker-component-host-fixture.ts'

export { double }

import type { Api, Model, ModelThinkingLevel } from '@earendil-works/pi-ai'
import type {
	ExtensionAPI,
	ExtensionContext,
	ScopedModel,
} from '@earendil-works/pi-coding-agent'
import type { ModelFallbackConfig } from '../extensions/model-fallback/config.ts'
import type { OpenRouterPricingSource } from '../extensions/model-fallback/openrouter-pricing.ts'

export interface ModelSpec {
	provider: string
	id: string
	name?: string
	reasoning?: boolean
	thinkingLevelMap?: Record<string, string | null>
	cost?: {
		input: number
		output: number
		cacheRead: number
		cacheWrite: number
	}
}

const DEFAULT_COST = { input: 1, output: 4, cacheRead: 0.2, cacheWrite: 1 }
const DEFAULT_CONTEXT_WINDOW = 200_000
const DEFAULT_MAX_TOKENS = 32_000

export function pickerModel(spec: ModelSpec): Model<Api> {
	return double<Model<Api>>({
		id: spec.id,
		name: spec.name ?? spec.id,
		api: 'openai-completions',
		provider: spec.provider,
		baseUrl: 'https://example.invalid',
		reasoning: spec.reasoning ?? false,
		thinkingLevelMap: spec.thinkingLevelMap,
		input: ['text'],
		cost: spec.cost ?? DEFAULT_COST,
		contextWindow: DEFAULT_CONTEXT_WINDOW,
		maxTokens: DEFAULT_MAX_TOKENS,
	})
}

export interface Dispatch {
	content: string
	expandPromptTemplates: boolean | undefined
	hadOpenModal: boolean
}

export interface Recorder {
	dispatches: Dispatch[]
	savedConfigs: ModelFallbackConfig[]
	setModels: string[]
	appliedLevels: ModelThinkingLevel[]
	notices: string[]
	modalsOpened: string[]
}

export interface PickerHarness extends Recorder {
	ctx: ExtensionContext
	pi: ExtensionAPI
	/** The live OpenRouter price list the picker reads. */
	pricing: OpenRouterPricingSource
	/** The models the failover engine is holding out; a test may set them. */
	cooldowns: Map<string, number>
	agentDir: string
	settingsPath: string
	/** The config the next picker run reads: the last write, or the start value. */
	currentConfig: () => ModelFallbackConfig
	setConfig: (config: ModelFallbackConfig) => void
	press: (key: string) => void
	/** A mouse event on the line the frame rendered at `lineIndex`. */
	mouse: (event: {
		type: string
		button?: string
		lineIndex: number
		wheelDelta?: number
	}) => void
	render: (width: number, height?: number) => string[]
}

export interface HarnessOptions {
	commands?: readonly string[]
	models?: readonly Model<Api>[]
	scoped?: readonly ScopedModel[]
	current?: Model<Api> | undefined
	level?: ModelThinkingLevel
	config?: ModelFallbackConfig
	settings?: unknown
	/** Models the failover engine is holding out right now, and until when. */
	cooldowns?: ReadonlyMap<string, number>
	/** Write a settings file at all; false models an unreadable agent dir. */
	writeSettings?: boolean
	/** Model a provider whose credentials are missing: `setModel` returns false. */
	setModelFails?: boolean
	/** The live OpenRouter price list; defaults to an endpoint that answers 503. */
	pricing?: OpenRouterPricingSource
}

/** The live list of a test that does not exercise pricing: an unreadable one. */
function unreadablePricing(): OpenRouterPricingSource {
	return createOpenRouterPricingSource(
		async () => new Response('', { status: 503 }),
	)
}

/** The `pi` surface the picker calls, recording every crossing. */
function createPi(
	recorder: Recorder,
	commands: readonly string[],
	isModalOpen: () => boolean,
	doesSetModelFail: boolean,
): ExtensionAPI {
	return double<ExtensionAPI>({
		setModel: async (model: Model<Api>) => {
			if (doesSetModelFail) return false
			recorder.setModels.push(`${model.provider}/${model.id}`)
			return true
		},
		setThinkingLevel: (level: ModelThinkingLevel) => {
			recorder.appliedLevels.push(level)
		},
		getCommands: () =>
			commands.map(name => ({ name, source: 'extension' as const })),
		sendUserMessage: (
			content: string,
			sendOptions?: { expandPromptTemplates?: boolean },
		) => {
			recorder.dispatches.push({
				content,
				expandPromptTemplates: sendOptions?.expandPromptTemplates,
				hadOpenModal: isModalOpen(),
			})
		},
	})
}

/** A private agent dir, so a test never reads the real settings file. */
function createAgentDir(options: HarnessOptions): {
	agentDir: string
	settingsPath: string
} {
	const agentDir = mkdtempSync(join(tmpdir(), 'model-picker-'))
	const settingsPath = join(agentDir, 'settings.json')
	if (options.writeSettings ?? true)
		writeFileSync(
			settingsPath,
			JSON.stringify(
				options.settings ?? { enabledModels: [] },
				null,
				'\t',
			),
		)
	process.env.PI_CODING_AGENT_DIR = agentDir
	return { agentDir, settingsPath }
}

function emptyRecorder(): Recorder {
	return {
		dispatches: [],
		savedConfigs: [],
		setModels: [],
		appliedLevels: [],
		notices: [],
		modalsOpened: [],
	}
}

export function pickerHarness(options: HarnessOptions = {}): PickerHarness {
	const { agentDir, settingsPath } = createAgentDir(options)
	const recorder = emptyRecorder()
	const host = createComponentHost(recorder)
	const models = options.models ?? []
	const current = options.current ?? models[0]
	let config = options.config ?? defaultConfig()
	const cooldowns = new Map(options.cooldowns ?? [])
	const ctx = double<ExtensionContext>({
		mode: 'tui',
		hasUI: true,
		model: current,
		thinkingLevel: options.level,
		scopedModels: options.scoped ?? (current ? [{ model: current }] : []),
		modelRegistry: {
			getAvailable: () => [...models],
			hasConfiguredAuth: () => true,
		},
		ui: host.ui,
	})
	return {
		...recorder,
		ctx,
		pi: createPi(
			recorder,
			options.commands ?? [],
			host.isOpen,
			options.setModelFails ?? false,
		),
		pricing: options.pricing ?? unreadablePricing(),
		cooldowns,
		agentDir,
		settingsPath,
		currentConfig: () => config,
		setConfig: next => {
			config = next
			recorder.savedConfigs.push(next)
		},
		press: host.press,
		mouse: host.mouse,
		render: host.render,
	}
}

/** Open the picker and let its component mount before any key is sent. */
export async function openPicker(
	harness: PickerHarness,
): Promise<{ opened: Promise<void> }> {
	const opened = openModelPicker(harness.ctx, {
		pi: harness.pi,
		getConfig: harness.currentConfig,
		setConfig: harness.setConfig,
		getCooldowns: () => harness.cooldowns,
		pricing: harness.pricing,
	})
	await tick()
	return { opened }
}

export function closeHarness(harness: PickerHarness): void {
	rmSync(harness.agentDir, { recursive: true, force: true })
}

export function settingsText(harness: PickerHarness): string {
	return readFileSync(harness.settingsPath, 'utf8')
}
