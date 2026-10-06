import { StringEnum } from '@earendil-works/pi-ai'
import { Type } from 'typebox'

import { actSchema, checksSchema } from './action-schema.ts'
import { height, width } from './config-schema.ts'

import type { Static } from 'typebox'
import type { configSchema } from './config-schema.ts'

const selector = Type.String({ minLength: 1, maxLength: 4000 })
const captureReference = Type.String({ minLength: 1, maxLength: 80 })
const url = Type.String({ maxLength: 8000 })

export type Config = Static<typeof configSchema>

export const defaults: Config = {
	EXECUTABLE_PATH: '',
	CDP_URL: '',
	HEADLESS: true,
	VIEWPORT_WIDTH: 1280,
	VIEWPORT_HEIGHT: 900,
	NAV_TIMEOUT_MS: 30000,
	/** A local dev app answers in well under this; a longer wait only delays a wrong selector's failure. */
	ACTION_TIMEOUT_MS: 4000,
	AUTO_SHOT: true,
	FULL_PAGE: false,
	SHOT_FORMAT: 'jpeg',
	SHOT_QUALITY: 80,
	MAX_CONSOLE: 200,
	MAX_EVAL_CHARS: 4000,
}

export const openSchema = Type.Object({
	url: Type.String({ minLength: 1, maxLength: 8000 }),
	wait_for: Type.Optional(selector),
	screenshot: Type.Optional(
		Type.Boolean({
			description:
				'Override AUTO_SHOT for this call; false avoids image tokens.',
		}),
	),
})

export const screenshotSchema = Type.Object({
	full_page: Type.Optional(Type.Boolean()),
	selector: Type.Optional(selector),
	width: Type.Optional(width),
	height: Type.Optional(height),
})

export const consoleSchema = Type.Object({
	level: Type.Optional(
		StringEnum(['all', 'error', 'warning', 'info'] as const),
	),
	max: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
})

export const evalSchema = Type.Object({
	expression: Type.Optional(
		Type.String({
			minLength: 1,
			maxLength: 50000,
			description:
				'One JavaScript expression. For several facts about one page state, use checks instead.',
		}),
	),
	checks: Type.Optional(checksSchema),
})

export const scenarioSchema = Type.Object({
	file: Type.String({
		minLength: 1,
		maxLength: 4000,
		description: 'Absolute path to the scenario JSON file.',
	}),
	runs: Type.Optional(
		Type.Integer({
			minimum: 1,
			maximum: 64,
			description: 'How many times to repeat the whole scenario.',
		}),
	),
	concurrency: Type.Optional(
		Type.Integer({
			minimum: 1,
			maximum: 16,
			description: 'Parallel isolated contexts.',
		}),
	),
	output_dir: Type.Optional(
		Type.String({
			minLength: 1,
			maxLength: 4000,
			description:
				'Where to keep checkpoint states and failure screenshots.',
		}),
	),
})

const scenarioStepSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
	act: actSchema,
	checkpoint: Type.Optional(Type.Boolean()),
})

export const scenarioFileSchema = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1 })),
	url: Type.String({ minLength: 1, maxLength: 8000 }),
	waitFor: Type.Optional(selector),
	extract: Type.Optional(Type.String({ minLength: 1, maxLength: 50000 })),
	probe: Type.Optional(
		Type.String({
			minLength: 1,
			maxLength: 5000,
			description:
				'A JS expression evaluated before and after every action and recorded as `observed: {before, after}` on the next checkpoint state, so an action the page refused is visible as before === after.',
		}),
	),
	steps: Type.Array(scenarioStepSchema, { minItems: 1 }),
})

export const specItemSchema = Type.Object({
	id: Type.String({ minLength: 1, maxLength: 200 }),
	requirement: Type.String({ minLength: 1, maxLength: 5000 }),
	source: Type.Optional(
		Type.String({
			maxLength: 500,
			description:
				'Where the requirement comes from (ticket, wiki section, prototype).',
		}),
	),
})

export const specFileSchema = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
	url: Type.Optional(url),
	items: Type.Array(specItemSchema, { minItems: 1 }),
})

/** The diff inputs of frontend_compare; also the contract iso-diff.ts consumes. */
const isoDiffFields = {
	captured_a: Type.Optional(
		Type.String({
			maxLength: 4000,
			description:
				'diff: specimen name (or absolute path) captured with mode=capture for the implementation side - the way to reach pages behind login, impersonation or demo toggles.',
		}),
	),
	captured_b: Type.Optional(
		Type.String({
			maxLength: 4000,
			description:
				'diff: captured specimen for the baseline (prototype) side. Each side takes exactly one input: a capture or a URL.',
		}),
	),
	implementation_url: Type.Optional(
		Type.String({
			...url,
			description:
				'diff: cold URL for the implementation side when it needs no session state.',
		}),
	),
	baseline_url: Type.Optional(
		Type.String({
			...url,
			description:
				'diff: cold URL for the baseline side - a served prototype, not a mockup image.',
		}),
	),
	scope: Type.Optional(
		Type.String({
			maxLength: 4000,
			description:
				"capture/diff: CSS selector restricting the specimen to one region (the app's main element) so wrapper chrome stays out; capture the same region on both sides.",
		}),
	),
	wait_for: Type.Optional(selector),
}

export const isoDiffSchema = Type.Object(isoDiffFields)

export const compareSchema = Type.Object({
	mode: StringEnum(['capture', 'diff', 'spec'] as const, {
		description:
			'capture: freeze the open page (name, scope?) into a specimen file. diff: component-level styles/geometry/text comparison of two sides. spec: judge the open page against a spec file (file).',
	}),
	name: Type.Optional(
		Type.String({
			minLength: 1,
			maxLength: 80,
			description:
				'capture: slug file name; reusing it overwrites the previous specimen.',
		}),
	),
	file: Type.Optional(
		Type.String({
			minLength: 1,
			maxLength: 4000,
			description:
				'spec: path to the spec JSON file ({name?, url?, items: [{id, requirement, source?}]}), absolute or relative to the cwd.',
		}),
	),
	...isoDiffFields,
})

export const pixelsSchema = Type.Object({
	mode: StringEnum(['capture', 'diff'] as const, {
		description:
			'capture: save an exact PNG of the open page state (name, wait_for, selector?). diff: compare two captures exactly (captured_a, captured_b).',
	}),
	name: Type.Optional(captureReference),
	selector: Type.Optional(selector),
	wait_for: Type.Optional(selector),
	captured_a: Type.Optional(captureReference),
	captured_b: Type.Optional(captureReference),
})

/** Shape of a captured specimen file as written by frontend_compare mode=capture. */
export const specimenFileSchema = Type.Object({
	url: Type.String(),
	title: Type.String(),
	lang: Type.String(),
	text: Type.String(),
	counts: Type.Record(Type.String(), Type.Number()),
	components: Type.Array(
		Type.Object({
			role: Type.String(),
			text: Type.String(),
			attributes: Type.Record(Type.String(), Type.String()),
			rect: Type.Object({
				x: Type.Number(),
				y: Type.Number(),
				width: Type.Number(),
				height: Type.Number(),
			}),
			styles: Type.Record(Type.String(), Type.String()),
			signature: Type.String(),
		}),
	),
})

export type OpenOptions = Static<typeof openSchema>
export type ScreenshotOptions = Static<typeof screenshotSchema>
export type EvalOptions = Static<typeof evalSchema>
export type ScenarioParams = Static<typeof scenarioSchema>
export type ScenarioFile = Static<typeof scenarioFileSchema>
export type ScenarioStep = Static<typeof scenarioStepSchema>
export type SpecItem = Static<typeof specItemSchema>
export type SpecFile = Static<typeof specFileSchema>
export type IsoDiffParams = Static<typeof isoDiffSchema>
export type CompareOptions = Static<typeof compareSchema>
export type PixelsOptions = Static<typeof pixelsSchema>
export type SpecimenFile = Static<typeof specimenFileSchema>
