/**
 * Apple container sandbox
 *
 * Routes pi's bash tool (and `!` commands) into the wt workspace of the current
 * worktree - its own Apple container VM, or its namespace on the shared dev
 * VM (the row's `vehicle`) - so project work runs in the VM where the
 * worktree is mounted at /workspace. wt owns the lifecycle of both: this extension only reads the
 * registry through `wt list --json`, asks `wt sync` to start or rebuild, and
 * never creates, names or removes containers. File tools stay host-side, which
 * is the same bytes through the mount - and because that write delivers no event
 * to the VM, a successful one makes the guest touch the file so its watchers
 * fire. A bare `git` command runs on the host instead: the VM mounts the worktree
 * but not the repository's git dir, which the worktree's `.git` file names. Neither
 * VM carries the host's `~/.gitconfig` either, so an activation hands the guest the
 * identity this worktree's commits carry on the host (guest-git.ts).
 * Both bash tools cap a command that
 * passed no timeout, and each container call is guarded by a VM liveness probe,
 * because a starved VM turns every command into an unbounded wait.
 *
 * Modules: index.ts (wiring and the command timeout policy), session.ts
 * (per-session runtime, prompt suffix and activation), devvm.ts (the shared
 * dev VM contract: names, argv shapes, tree-path read), guest-git.ts (the host git
 * identity, inherited into the guest at activation), sandbox-prompt.ts (the
 * sandbox section's text, the addresses a human may be given included),
 * container-command.ts (the /container surface), wt.ts (wt CLI boundary), container.ts (Apple container CLI
 * boundary and guest call lifecycle), container-cli.ts (the CLI process itself),
 * exec-session.ts (guest process ownership: one session per call, its kill token
 * and its host-side record), bash-ops.ts (BashOperations and host-to-guest path
 * mapping).
 */
import { createBashTool } from '@earendil-works/pi-coding-agent'

import { containerCommandHandler } from './container-command.ts'
import {
	clearRuntimeState,
	sandboxSystemPromptSuffix,
	sandboxedBashTool,
	userBashOperations,
} from './runtime.ts'
import { startSandboxSession, notifyGuestOfHostEdit } from './session.ts'

import type {
	BashToolInput,
	ExtensionAPI,
} from '@earendil-works/pi-coding-agent'

const HOST_TOOL_DESCRIPTION =
	'Run a command on the macOS HOST, outside the container sandbox. Use ONLY for host administration that cannot run inside the container: brew, osascript, launchctl, /Applications, macOS settings, host networking. NEVER use it for project work (build, test, lint, dependency install, dev servers, file inspection) - the bash tool already runs that inside the container with the worktree mounted.'
const HOST_PROMPT_SNIPPET = 'macOS administration only, never project work'
const HOST_PROMPT_GUIDELINES = [
	'Use host only for macOS administration (brew, osascript, launchctl) that cannot run inside the container.',
	'Never use host for project work; the bash tool runs project commands inside the container with the worktree mounted.',
]

/**
 * The bash tool's own prompt text is pi's: "Execute bash commands (ls, grep,
 * find, etc.)" plus the guideline "Use bash for file operations like ls, rg,
 * find". Read at the moment of the call it beats any rule stated further up,
 * so an override that keeps it tells the model to do what AGENTS.md refuses,
 * every turn. These replace both lines; the enforcement they name is
 * `extensions/tool-guard`, the rule itself is AGENTS.md # Tool calls.
 */
const BASH_PROMPT_SNIPPET =
	'Run commands in the sandbox: builds, tests, git, installs, pipelines'
const BASH_PROMPT_GUIDELINES = [
	'Never use bash to list, search or read files - `ls`, `find`, `cat`, `head`, `tail`, `grep`/`rg`, piped or redirected included: call the `ls`, `find`, `grep` or `read` tool instead, which caps, renders and caches its result.',
	'Use bash for work no tool owns: builds, tests, git, installs, and pipelines that transform or store (`jq`, `sed`, counts, redirects to a file).',
]
const TOOL_CHOICE_GUIDANCE =
	' Never use it to list, search or read files: `ls`, `grep`, `find` and `read` own that work and `tool-guard` refuses the bash form, piped or redirected included.'

/** pi's bash timeout is optional: without one a stuck command holds the whole turn until a human stops it. */
export const DEFAULT_COMMAND_TIMEOUT_SECONDS = 60
const TIMEOUT_GUIDANCE = ` Commands are killed after \`timeout\` seconds; without it they are capped at ${DEFAULT_COMMAND_TIMEOUT_SECONDS} seconds. Pass a larger \`timeout\` for slow work (test suites, installs), or detach it and check its log in a later call - never make a call wait with \`sleep\`.`

/** The cap is a default, never a clamp: an explicit timeout is left untouched. */
export function withDefaultTimeout(
	params: BashToolInput,
): BashToolInput & { timeout: number } {
	return {
		...params,
		timeout: params.timeout ?? DEFAULT_COMMAND_TIMEOUT_SECONDS,
	}
}

function registerShellTools(pi: ExtensionAPI): void {
	const localBash = createBashTool(process.cwd())

	pi.registerTool({
		...localBash,
		name: 'host',
		label: 'bash (macOS host)',
		description: `${HOST_TOOL_DESCRIPTION}${TIMEOUT_GUIDANCE}`,
		promptSnippet: HOST_PROMPT_SNIPPET,
		promptGuidelines: HOST_PROMPT_GUIDELINES,
		async execute(...execArgs: Parameters<typeof localBash.execute>) {
			const [toolCallId, params, ...rest] = execArgs
			return localBash.execute(
				toolCallId,
				withDefaultTimeout(params),
				...rest,
			)
		},
	})

	pi.registerTool({
		...localBash,
		label: 'bash (container)',
		description: `${localBash.description}${TOOL_CHOICE_GUIDANCE}${TIMEOUT_GUIDANCE}`,
		promptSnippet: BASH_PROMPT_SNIPPET,
		promptGuidelines: BASH_PROMPT_GUIDELINES,
		async execute(...execArgs: Parameters<typeof localBash.execute>) {
			const [toolCallId, params, ...rest] = execArgs
			const capped = withDefaultTimeout(params)
			const sandboxed = sandboxedBashTool()
			return sandboxed
				? sandboxed.execute(toolCallId, capped, ...rest)
				: localBash.execute(toolCallId, capped, ...rest)
		},
	})
}

export default function containerSandbox(pi: ExtensionAPI): void {
	let wasHostEnabled = false
	pi.registerFlag('no-container', {
		description: 'Disable routing bash into the Apple container sandbox',
		type: 'boolean',
		default: false,
	})
	registerShellTools(pi)
	pi.on('user_bash', () => userBashOperations())

	// A host-side write reaches the VM as changed bytes with no event, so the guest is asked to
	// touch what changed: without that touch no in-VM watcher fires for an agent's own edit.
	pi.on('tool_result', event => notifyGuestOfHostEdit(event))

	// Tell the model it is inside a container, every turn, only while active.
	pi.on('before_agent_start', event => ({
		systemPrompt:
			sandboxSystemPromptSuffix(event.systemPrompt) ?? event.systemPrompt,
	}))

	pi.on('session_start', async (_event, ctx) => {
		wasHostEnabled = pi.getActiveTools().includes('host')
		await startSandboxSession(pi, ctx)
		if (!sandboxedBashTool()) {
			pi.setActiveTools(
				pi.getActiveTools().filter(name => name !== 'host'),
			)
		}
	})
	pi.registerCommand('container', {
		description:
			'Apple container sandbox: status · sync · reap · restart · stop',
		handler: async (args, ctx) => {
			await containerCommandHandler(args, ctx, pi)
			if (wasHostEnabled && sandboxedBashTool()) {
				pi.setActiveTools([
					...new Set([...pi.getActiveTools(), 'host']),
				])
			}
		},
	})
	pi.on('session_shutdown', () => clearRuntimeState())
}
