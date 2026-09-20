/** What one /simplify run needs from the session: the wiring every stage shares. */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from '@earendil-works/pi-coding-agent'
import type { ChildCapture } from './capture.ts'
import type { TurnWatcher } from './turns.ts'

export interface RunDeps {
	pi: ExtensionAPI
	ctx: ExtensionCommandContext
	capture: ChildCapture
	turns: TurnWatcher
}
