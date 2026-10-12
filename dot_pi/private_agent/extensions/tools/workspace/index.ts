/**
 * Workspace: when Pi starts in a workspace anchor (a local directory holding
 * `.workspace.json`), the project lives on a Boat and every tool reaches it
 * over ssh, while Pi itself (config, skills, sessions) stays on the Mac.
 * Inert anywhere else.
 *
 * - tools.ts: read/write/edit/ls/find (and grep via remote-grep.ts) re-registered; a path under the
 *   anchor runs on the Boat, any other path keeps Pi's local tool.
 * - `#lib/runtime/pi-operations.ts`: Pi operation sets over the runtime (also used by
 *   tools/guard for bash).
 * - status.ts: wakes a stopped Boat at session start, shows its ports and
 *   installs file-completion.ts (`@file` from the Boat's checkout).
 * - `!` commands run on the Boat; the system prompt names the Boat checkout as cwd.
 */
import { anchorFor, targetSync } from '#lib/runtime/anchor.ts'
import { bashOperations } from '#lib/runtime/pi-operations.ts'
import { runtimeFor } from '#lib/runtime/runtime.ts'

import { watchBoat } from './status.ts'
import { registerBoatTools } from './tools.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export default function workspace(pi: ExtensionAPI): void {
	const anchor = anchorFor(process.cwd())
	if (!anchor) return
	registerBoatTools(pi)
	watchBoat(pi, anchor)
	pi.on('user_bash', event => {
		const runtime = runtimeFor(event.cwd)
		if (!runtime.isRemote) return undefined
		return { operations: bashOperations(runtime) }
	})
	pi.on('before_agent_start', event => {
		const target = targetSync(anchor)
		Reflect.set(
			event.systemPromptOptions,
			'cwd',
			`${target.remoteRoot} (Boat ${target.host})`,
		)
	})
}
