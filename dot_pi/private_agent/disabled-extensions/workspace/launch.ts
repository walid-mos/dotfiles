/** One checkout → one running Pi: pane lookup, agent start and the first prompt. */

import { realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'

import { promptPi, snapshotPanes, startPi } from './herdr.ts'

import type { PaneInfo } from './herdr.ts'
import type { Checkout } from './wt.ts'

const MS_PER_SECOND = 1000
const PANE_WAIT_MS = 20_000
const PANE_WAIT_SECONDS = PANE_WAIT_MS / MS_PER_SECOND
const PANE_POLL_INTERVAL_MS = 500
const SHELL_READY_WAIT_MS = 30_000
const SHELL_READY_POLL_INTERVAL_MS = 1_000
/** herdr agent names cap at 32: 'wt-' + a cut branch slug + an 8-hex digest. */
const AGENT_DIGEST_CHARS = 8
const AGENT_BRANCH_SLUG_CHARS = 18

export interface LaunchedPi {
	paneId: string
	name: string
	started: boolean
	prompted: boolean
}

function sameDirectory(left: string, right: string): boolean {
	return canonical(left) === canonical(right)
}

function canonical(directory: string): string {
	try {
		return realpathSync(directory)
	} catch {
		return directory
	}
}

/** The pane wt just confirmed to stand in the checkout, or a refusal to surface. */
export async function findWorkspacePane(checkout: Checkout): Promise<PaneInfo> {
	const deadline = Date.now() + PANE_WAIT_MS
	for (;;) {
		// One snapshot per poll: herdr state changes between iterations, not within one.
		// oxlint-disable-next-line no-await-in-loop
		const panes = await snapshotPanes()
		const pane =
			panes.find(
				candidate => candidate.workspaceId === checkout.surfaceId,
			) ??
			panes.find(candidate => sameDirectory(candidate.cwd, checkout.path))
		if (pane) return pane
		if (Date.now() >= deadline) {
			throw new Error(
				`No herdr pane appeared for ${checkout.path} within ${PANE_WAIT_SECONDS}s`,
			)
		}
		// oxlint-disable-next-line no-await-in-loop
		await new Promise(resolve => setTimeout(resolve, PANE_POLL_INTERVAL_MS))
	}
}

/** Start Pi in the checkout's pane unless one already runs there. */
export async function launchPi(
	checkout: Checkout,
	pane: PaneInfo,
): Promise<LaunchedPi> {
	const name = agentName(checkout)
	if (pane.agent === 'pi') {
		return { paneId: pane.paneId, name, started: false, prompted: false }
	}
	await startPiWhenShellReady(name, pane.paneId)
	return { paneId: pane.paneId, name, started: true, prompted: false }
}

/** A fresh pane still prints its zsh welcome banner; herdr refuses until the prompt shows. */
async function startPiWhenShellReady(
	name: string,
	paneId: string,
): Promise<void> {
	const deadline = Date.now() + SHELL_READY_WAIT_MS
	for (;;) {
		try {
			// oxlint-disable-next-line no-await-in-loop
			await startPi(name, paneId)
			return
		} catch (error) {
			throwUnlessShellRace(error, deadline, paneId, name)
		}
		// oxlint-disable-next-line no-await-in-loop
		await new Promise(resolve =>
			setTimeout(resolve, SHELL_READY_POLL_INTERVAL_MS),
		)
	}
}

/** Hand the new Pi its first turn; the caller reports the submission. */
export async function submitFirstPrompt(
	launched: LaunchedPi,
	text: string,
): Promise<LaunchedPi> {
	await promptPi(launched.name, text)
	return { ...launched, prompted: true }
}

/** A stable per-checkout agent label. herdr refuses anything but 1-32 chars of
 * lowercase letters, digits, '-' and '_', and names are unique forever, so the
 * branch slug is cut and an 8-hex digest of branch + surface id keeps a
 * re-spawn from colliding with a leaked agent. */
export function agentName(checkout: Pick<Checkout, 'branch' | 'surfaceId'>): string {
	const digest = createHash('sha256')
		.update(`${checkout.branch}-${checkout.surfaceId}`)
		.digest('hex')
		.slice(0, AGENT_DIGEST_CHARS)
	const branchSlug = checkout.branch
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, AGENT_BRANCH_SLUG_CHARS)
	return `wt-${branchSlug}-${digest}`
}

/** A pane-busy refusal during the banner is a wait; anything else or a late one is a failure. */
function throwUnlessShellRace(
	error: unknown,
	deadline: number,
	paneId: string,
	name: string,
): void {
	const shellStillBusy =
		error instanceof Error && error.message.includes('agent_pane_busy')
	if (shellStillBusy && Date.now() < deadline) return
	if (!shellStillBusy) throw error
	throw new Error(
		`${paneId} never became an available shell. A half-started agent can hold it: check \`herdr agent get ${name}\` and close that workspace with \`wt clean\`.`,
	)
}
