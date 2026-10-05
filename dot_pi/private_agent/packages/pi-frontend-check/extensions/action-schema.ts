import { StringEnum } from '@earendil-works/pi-ai'
import { Type } from 'typebox'

import type { Static } from 'typebox'

const selector = Type.String({ minLength: 1, maxLength: 4000 })

export const actionNames = [
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

export const actSchema = Type.Object({
	...actionProperties,
	screenshot: Type.Optional(Type.Boolean()),
})

export const batchSchema = Type.Object({
	steps: Type.Array(
		Type.Object({
			id: Type.String({ minLength: 1, maxLength: 100 }),
			...actionProperties,
		}),
		{ minItems: 1, maxItems: 25 },
	),
	screenshot: Type.Optional(Type.Boolean()),
})

export type ActOptions = Static<typeof actSchema>
export type BatchOptions = Static<typeof batchSchema>
export type BatchStep = BatchOptions['steps'][number]
