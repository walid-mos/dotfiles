import { StringEnum } from '@earendil-works/pi-ai'
import { Type } from 'typebox'

import { actSchema } from './action-schema.ts'
import { height, width } from './config-schema.ts'
import { pixelProbeSchema } from './pixel-progress.ts'

import type { Static } from 'typebox'
import type { configSchema } from './config-schema.ts'

const selector = Type.String({ minLength: 1, maxLength: 4000 })

export type Config = Static<typeof configSchema>

export const defaults: Config = {
	EXECUTABLE_PATH: '',
	CDP_URL: '',
	HEADLESS: true,
	VIEWPORT_WIDTH: 1280,
	VIEWPORT_HEIGHT: 900,
	NAV_TIMEOUT_MS: 30000,
	ACTION_TIMEOUT_MS: 10000,
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
	expression: Type.String({ minLength: 1, maxLength: 50000 }),
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
	url: Type.Optional(Type.String({ maxLength: 8000 })),
	items: Type.Array(specItemSchema, { minItems: 1 }),
})

export const specCheckSchema = Type.Object({
	file: Type.String({
		minLength: 1,
		maxLength: 4000,
		description:
			'Path to the spec JSON file ({name?, url?, items: [{id, requirement, source?}]}), absolute or relative to the cwd.',
	}),
	wait_for: Type.Optional(selector),
})

export const isoDiffSchema = Type.Object({
	implementation_url: Type.Optional(
		Type.String({
			maxLength: 8000,
			description:
				'Cold URL for the implementation side, if not using captured_a.',
		}),
	),
	baseline_url: Type.Optional(
		Type.String({
			maxLength: 8000,
			description:
				'Cold URL for the baseline side - a served prototype, not a mockup image - if not using captured_b.',
		}),
	),
	captured_a: Type.Optional(
		Type.String({
			maxLength: 4000,
			description:
				'Specimen captured with frontend_capture_specimen for the implementation side (name or absolute path). Use this when the page needs session state - login, impersonation, demo toggles - that a cold URL cannot reach.',
		}),
	),
	captured_b: Type.Optional(
		Type.String({
			maxLength: 4000,
			description:
				'Captured specimen for the baseline side. Each side takes exactly one input: a capture or a URL.',
		}),
	),
	scope: Type.Optional(
		Type.String({
			maxLength: 4000,
			description:
				"CSS selector restricting URL-side specimens to that element - an app region, so wrapper chrome (a prototype's demo panel, marketing headers) stays out of the diff.",
		}),
	),
	wait_for: Type.Optional(selector),
})

export const capturePixelsSchema = Type.Object({
	name: Type.String({ minLength: 1, maxLength: 80 }),
	selector: Type.Optional(selector),
	wait_for: selector,
})

export const pixelDiffSchema = Type.Object({
	captured_a: Type.String({ minLength: 1, maxLength: 80 }),
	captured_b: Type.String({ minLength: 1, maxLength: 80 }),
	probe: Type.Optional(pixelProbeSchema),
})

export const captureSpecimenSchema = Type.Object({
	name: Type.String({
		minLength: 1,
		maxLength: 80,
		description:
			'Slug file name for the capture; reusing it overwrites the previous specimen.',
	}),
	scope: Type.Optional(
		Type.String({
			maxLength: 4000,
			description:
				'CSS selector restricting the capture to that element - capture the same region on both diff sides so they compare like for like.',
		}),
	),
	wait_for: Type.Optional(selector),
})

/** Shape of a captured specimen file as written by frontend_capture_specimen. */
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
export type ScenarioParams = Static<typeof scenarioSchema>
export type ScenarioFile = Static<typeof scenarioFileSchema>
export type ScenarioStep = Static<typeof scenarioStepSchema>
export type SpecItem = Static<typeof specItemSchema>
export type SpecFile = Static<typeof specFileSchema>
export type SpecCheckParams = Static<typeof specCheckSchema>
export type IsoDiffParams = Static<typeof isoDiffSchema>
export type CaptureSpecimenParams = Static<typeof captureSpecimenSchema>
export type SpecimenFile = Static<typeof specimenFileSchema>
