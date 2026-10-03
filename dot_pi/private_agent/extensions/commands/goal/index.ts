/**
 * Branch-local goal checklist with local evidence records, not remote completion gates.
 * route-events.ts records human input; edits.ts owns transitions; tool.ts and
 * commands.ts own entry points; manage.ts checks explicit re-evaluation authority.
 * lib/goal/state.ts owns branch entries; status.ts owns the existing display.
 */
import { registerGoalCommands } from './commands.ts'
import { registerGoalRouting } from './route-events.ts'
import { registerGoalStatus } from './status.ts'
import { registerGoalTool } from './tool.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export default function goal(pi: ExtensionAPI): void {
	if (process.env.PI_SUBAGENT_CHILD === '1') return
	registerGoalStatus(pi)
	registerGoalRouting(pi)
	registerGoalTool(pi)
	registerGoalCommands(pi)
}
