/**
 * /workspace - a wt worktree workspace on the wanted branch, Pi already running in its herdr pane.
 *
 * `/workspace <branch | work to do> [--base <ref>] [--carry] [--focus]`
 *
 * wt owns the checkout lifecycle and herdr owns the surface, so this extension only
 * drives them: a branch a checkout already holds is switched to, a free branch is
 * spawned with `wt spawn --pane --async` (provisioning keeps running in the
 * background), the new workspace's pane starts plain Pi, and the words the command
 * was given become that Pi's first prompt; `--` splits the two roles - text
 * before is the work, text after is the prompt verbatim - and without it the
 * whole text is both. Free text names the branch too: the session model
 * proposes candidates and Jev (when configured) picks the best (name.ts); a
 * real branch - a token with a path or a bare name wt already knows - is used
 * as-is.
 * The workspace opens in the background: only `--focus` brings it to the front,
 * because opening one must not move the operator's focus.
 *
 * Modules:
 *   args.ts   - parsing and the usage line
 *   name.ts   - branch naming: session model proposes, Jev picks
 *   wt.ts     - the only wt caller (list, spawn, switch)
 *   container-config - the container-sandbox fix surface: .pi/container.json
 *             is derived (session model) before a new workspace's container
 *             is spawned, so wt reads a judged declaration, not bare defaults
 *   herdr.ts  - the only herdr caller (snapshot, agent start, agent prompt)
 *   launch.ts - one checkout -> one running Pi
 *   index.ts  - wiring only
 */

import { parseWorkspaceArgs, splitCommandTokens } from './args.ts'
import { findWorkspacePane, launchPi, submitFirstPrompt } from './launch.ts'
import { deriveBranchName } from './name.ts'
import { listWorkspaces, spawnWorkspace, switchWorkspace } from './wt.ts'
import { ensureContainerConfig } from '../container-sandbox/container-config.ts'
import {
	containerizationActive,
	sourceRepoRoot,
} from '../container-sandbox/container-config-facts.ts'

import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from '@earendil-works/pi-coding-agent'
import type { AutocompleteItem } from '@earendil-works/pi-tui'
import type { LaunchedPi } from './launch.ts'
import type { Checkout, SpawnOptions } from './wt.ts'

const STATUS_KEY = 'workspace'

/** Branch names the slash menu can offer, refreshed on session start and after each run. */
let branchChoices: string[] = []

export default function workspaceExtension(pi: ExtensionAPI): void {
	pi.on('session_start', () => {
		void refreshBranchCache(process.cwd())
	})
	pi.registerCommand('workspace', {
		description:
			'wt worktree workspace on a branch, Pi already running in its herdr pane',
		getArgumentCompletions: completeBranch,
		handler: runWorkspace,
	})
}

function completeBranch(prefix: string): AutocompleteItem[] | null {
	const matches = branchChoices.filter(branch => branch.startsWith(prefix))
	if (!matches.length) return null
	return matches.map(branch => ({ value: branch, label: branch }))
}

async function refreshBranchCache(cwd: string): Promise<void> {
	try {
		branchChoices = (await listWorkspaces(cwd))
			.map(row => row.branch)
			.toSorted()
	} catch {
		branchChoices = []
	}
}

async function runWorkspace(
	rawArgs: string,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const parsed = parseWorkspaceArgs(
		splitCommandTokens(rawArgs),
		branchChoices,
	)
	if (!parsed.ok) {
		ctx.ui.notify(parsed.usage, 'error')
		return
	}
	const { base, shouldCarry, shouldFocus, prompt } = parsed.args
	const options: SpawnOptions = { base, shouldCarry, shouldFocus }
	const cwd = process.cwd()

	let { branch } = parsed.args
	if (!branch) {
		ctx.ui.setStatus(STATUS_KEY, 'naming branch…')
		try {
			branch = await deriveBranchName(
				prompt ?? '',
				branchChoices,
				ctx,
			)
		} catch (error) {
			ctx.ui.notify(failureText(error), 'error')
			ctx.ui.setStatus(STATUS_KEY, undefined)
			return
		}
	}

	ctx.ui.setStatus(STATUS_KEY, `wt: ${branch} …`)
	try {
		const checkout = await enterCheckout(branch, options, cwd, ctx)
		ctx.ui.setStatus(STATUS_KEY, `pi: ${checkout.branch}`)
		const pane = await findWorkspacePane(checkout)
		const launched = await launchPi(checkout, pane)
		const final = prompt
			? await submitFirstPrompt(launched, prompt)
			: launched
		ctx.ui.notify(summarize(checkout, final), 'info')
		void refreshBranchCache(cwd)
	} catch (error) {
		ctx.ui.notify(failureText(error), 'error')
	} finally {
		ctx.ui.setStatus(STATUS_KEY, undefined)
	}
}

/** A checkout that already holds the branch is entered; a free branch is spawned.
 * A spawn is also where the container config fix runs: wt reads the source
 * repo's .pi/container.json at spawn, so the file must be current first. */
async function enterCheckout(
	branch: string,
	options: SpawnOptions,
	cwd: string,
	ctx: ExtensionCommandContext,
): Promise<Checkout> {
	const holder = (await listWorkspaces(cwd)).find(
		row => row.branch === branch,
	)
	if (holder) return switchWorkspace(holder.path, options.shouldFocus, cwd)
	await fixContainerConfigForSpawn(cwd, ctx)
	return spawnWorkspace(branch, options, cwd)
}

/** Derive .pi/container.json for a repo that declares none, so wt spawns the
 * container from a judged declaration instead of bare defaults. Only when wt
 * will containerize, and never blocking: a failed derivation falls back to
 * wt's own defaults with a warning. */
async function fixContainerConfigForSpawn(
	cwd: string,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const repoRoot = await sourceRepoRoot(cwd)
	if (!repoRoot || !containerizationActive(repoRoot)) return
	const fix = await ensureContainerConfig(repoRoot, ctx)
	if (fix && fix.kind === 'failed') {
		ctx.ui.notify(
			`No .pi/container.json derived (${fix.reason}); wt spawns with its defaults.`,
			'warning',
		)
	}
}

function summarize(checkout: Checkout, launched: LaunchedPi): string {
	const piState = launched.started
		? `pi started (${launched.name})`
		: 'pi already running'
	const prompted = launched.prompted ? ', first prompt submitted' : ''
	return `${checkout.branch} → ${checkout.path} · ${piState}${prompted}`
}

function failureText(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}
