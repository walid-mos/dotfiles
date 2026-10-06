import { StringEnum } from '@earendil-works/pi-ai'
import { Type } from 'typebox'

import type { Static } from 'typebox'

const selector = Type.String({ minLength: 1, maxLength: 4000 })
const MAX_BATCH_STEPS = 25
const MAX_CHECKS = 40

export const actionNames = [
	'goto',
	'click',
	'type',
	'press',
	'hover',
	'select',
	'scroll',
	'wait_for',
	'set_files',
] as const

const actionProperties = {
	action: StringEnum(actionNames),
	target: Type.Optional(selector),
	url: Type.Optional(
		Type.String({
			minLength: 1,
			maxLength: 8000,
			description:
				'For goto only: HTTP(S) URL, host:port or HTML path to navigate to in the current tab.',
		}),
	),
	text: Type.Optional(Type.String({ maxLength: 50000 })),
	key: Type.Optional(Type.String({ minLength: 1 })),
	files: Type.Optional(
		Type.Array(Type.String({ minLength: 1, maxLength: 2000 }), {
			maxItems: 10,
			description:
				'Absolute local file paths for set_files (file upload).',
		}),
	),
	popup: Type.Optional(
		Type.Boolean({
			description:
				'For a click that opens a new tab: wait for the popup before inspecting it.',
		}),
	),
	wait_for: Type.Optional(selector),
}

/** A scenario step: the batch action fields plus its own evidence screenshot. */
export const actSchema = Type.Object({
	...actionProperties,
	screenshot: Type.Optional(Type.Boolean()),
})

/** Named JavaScript expressions evaluated in the page, returned as one object. */
export const checksSchema = Type.Array(
	Type.Object({
		name: Type.String({ minLength: 1, maxLength: 80 }),
		expression: Type.String({ minLength: 1, maxLength: 50000 }),
	}),
	{ minItems: 1, maxItems: MAX_CHECKS },
)

export const captureStepSchema = Type.Object({
	name: Type.String({ minLength: 1, maxLength: 80 }),
	selector: Type.Optional(selector),
	wait_for: selector,
})

export const batchSchema = Type.Object({
	steps: Type.Array(
		Type.Object({
			id: Type.String({ minLength: 1, maxLength: 100 }),
			...actionProperties,
		}),
		{ minItems: 1, maxItems: MAX_BATCH_STEPS },
	),
	evals: Type.Optional(checksSchema),
	capture: Type.Optional(captureStepSchema),
	screenshot: Type.Optional(Type.Boolean()),
})

export type ActOptions = Static<typeof actSchema>
export type Checks = Static<typeof checksSchema>
export type CaptureStep = Static<typeof captureStepSchema>
export type BatchOptions = Static<typeof batchSchema>
export type BatchStep = BatchOptions['steps'][number]
