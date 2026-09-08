import { createBashTool } from '@earendil-works/pi-coding-agent'

import {
	clearRuntimeState,
	containerCommandHandler,
	runSandboxedOrLocal,
	sandboxSystemPromptSuffix,
	startSandboxSession,
	userBashResult,
} from './session'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

/** Host escape hatch for administration the container cannot do. */
function registerHostTool(
	pi: ExtensionAPI,
	localBash: ReturnType<typeof createBashTool>,
): void {
	pi.registerTool({
		...localBash,
		name: 'host',
		label: 'bash (macOS host)',
		description:
			'Run a command on the macOS HOST, outside the container sandbox. Use ONLY for host administration that cannot run inside the container: brew, osascript, launchctl, /Applications apps, macOS system settings, host networking. NEVER use it for project work (build, test, lint, dependency install, dev servers, file inspection) - the bash tool already covers the mounted project inside the container.',
		async execute(...execArgs: Parameters<typeof localBash.execute>) {
			return localBash.execute(...execArgs)
		},
	})
}

function registerContainerTool(
	pi: ExtensionAPI,
	localBash: ReturnType<typeof createBashTool>,
): void {
	pi.registerTool({
		...localBash,
		label: 'bash (container)',
		async execute(...execArgs: Parameters<typeof localBash.execute>) {
			return runSandboxedOrLocal(localBash, execArgs)
		},
	})
}

export default function (pi: ExtensionAPI): void {
	pi.registerFlag('no-container', {
		description: 'Disable routing bash into the Apple container sandbox',
		type: 'boolean',
		default: false,
	})

	const localBash = createBashTool(process.cwd())
	registerHostTool(pi, localBash)
	registerContainerTool(pi, localBash)

	pi.on('user_bash', () => userBashResult())

	// Tell the model it is inside a container, every turn, only while active.
	pi.on('before_agent_start', event => ({
		systemPrompt:
			sandboxSystemPromptSuffix(event.systemPrompt) ?? event.systemPrompt,
	}))

	pi.on('session_start', async (_event, ctx) => startSandboxSession(pi, ctx))
	pi.registerCommand('container', {
		description:
			'Apple container sandbox: status · enable · disable · stop',
		handler: async (args, ctx) => containerCommandHandler(args, ctx),
	})
	pi.on('session_shutdown', () => clearRuntimeState())
}
