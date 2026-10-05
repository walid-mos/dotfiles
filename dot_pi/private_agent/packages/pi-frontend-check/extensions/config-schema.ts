import { StringEnum } from '@earendil-works/pi-ai'
import { Type } from 'typebox'

export const width = Type.Integer({ minimum: 200, maximum: 3840 })
export const height = Type.Integer({ minimum: 200, maximum: 2160 })

export const configSchema = Type.Object(
	{
		EXECUTABLE_PATH: Type.String(),
		CDP_URL: Type.String({
			description:
				'Shared loopback CDP endpoint; empty keeps isolated frontend tests.',
			pattern: '^(?:|http://127\\.0\\.0\\.1:[0-9]{1,5}/?)$',
		}),
		HEADLESS: Type.Literal(true),
		VIEWPORT_WIDTH: width,
		VIEWPORT_HEIGHT: height,
		NAV_TIMEOUT_MS: Type.Integer({ minimum: 100, maximum: 120000 }),
		ACTION_TIMEOUT_MS: Type.Integer({ minimum: 100, maximum: 120000 }),
		AUTO_SHOT: Type.Boolean(),
		FULL_PAGE: Type.Boolean(),
		SHOT_FORMAT: StringEnum(['jpeg', 'png'] as const),
		SHOT_QUALITY: Type.Integer({ minimum: 1, maximum: 100 }),
		MAX_CONSOLE: Type.Integer({ minimum: 1, maximum: 1000 }),
		MAX_EVAL_CHARS: Type.Integer({ minimum: 100, maximum: 50000 }),
	},
	{ additionalProperties: false },
)
