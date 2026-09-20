// The guest's git identity. Neither VM carries the host's ~/.gitconfig - the share starts at
// the worktree's parent, never at the home directory - so a commit inside the sandbox failed
// with "Author identity unknown" while the same commit on the host succeeded, and a session
// that hit it had no honest identity left to commit with. The identity in effect for this
// worktree is read on the host through pi's own local shell (bash-ops routes a bare `git`
// there, so the two agree by construction) and applied to the guest's global config as the
// user a guest call runs as: written only where the guest differs, so a repository's own
// local identity still wins and is never rewritten, and kept in the guest across sessions.
import { execInContainer } from './container.ts'
import { GUEST_CONTROL_TIMEOUT_SECONDS } from './exec-session.ts'

import type { BashOperations } from '@earendil-works/pi-coding-agent'
import type { GuestTarget } from './container.ts'

/** The keys an author identity is made of, in the order git reads them. */
const IDENTITY_FIELDS = [
	{ field: 'name', configKey: 'user.name' },
	{ field: 'email', configKey: 'user.email' },
] as const

/** Printed by the guest script when it writes, so the call can say what it changed. */
const GUEST_IDENTITY_MARKER = 'wt-git-identity-written'

/** Reading two keys from the host's own shell is local and fast; it must never hold a session. */
const HOST_READ_TIMEOUT_SECONDS = 5

export interface GitIdentity {
	name: string
	email: string
}

/** What the guest needed, as the session reports it: nothing to say is not a failure. */
export type GuestIdentityOutcome =
	| { kind: 'inherited'; identity: GitIdentity }
	| { kind: 'unchanged' }

/**
 * One config value as a single shell word. A name or an address is arbitrary text - spaces,
 * quotes and `$` included - and it is embedded in a script, so the single-quoted form is the
 * only shape that cannot be read as syntax.
 */
function shellQuote(configValue: string): string {
	return `'${configValue.split("'").join(`'\\''`)}'`
}

/**
 * The host-side read, run with the worktree as its cwd: `git config --get` resolves local
 * before global, so a repository that names its own author wins here exactly as it does on a
 * host commit. A key nothing sets exits non-zero, which is an empty value, not a failure.
 */
async function hostConfigValue(
	hostOps: BashOperations,
	worktreePath: string,
	configKey: string,
): Promise<string> {
	const chunks: Buffer[] = []
	const run = await hostOps.exec(
		`git config --get ${configKey}`,
		worktreePath,
		{
			onData: chunk => chunks.push(chunk),
			timeout: HOST_READ_TIMEOUT_SECONDS,
		},
	)
	if (run.exitCode !== 0) return ''
	return Buffer.concat(chunks).toString('utf-8').trim()
}

/** The identity the host would author a commit with in this worktree, empty keys included. */
export async function hostGitIdentity(
	hostOps: BashOperations,
	worktreePath: string,
): Promise<GitIdentity> {
	const [name, email] = await Promise.all([
		hostConfigValue(hostOps, worktreePath, IDENTITY_FIELDS[0].configKey),
		hostConfigValue(hostOps, worktreePath, IDENTITY_FIELDS[1].configKey),
	])
	return { name, email }
}

/** One key's guest command: compare, write when it differs, and say that it wrote. */
function guestKeyCommand(input: {
	configKey: string
	configuredValue: string
}): string {
	const { configKey, configuredValue } = input
	const quoted = shellQuote(configuredValue)
	return `if [ "$(git config --get ${configKey})" != ${quoted} ]; then git config --global ${configKey} ${quoted} || exit 1; echo ${GUEST_IDENTITY_MARKER}; fi`
}

/**
 * The guest command that brings its global config in line: each key is written only when the
 * value it resolves to differs, so a repository's own `user.email` is left alone and a session
 * that changes nothing runs one `git config --get` per key. A write that fails ends the script
 * with a non-zero status, so the caller reports a guest that could not be provisioned instead
 * of a commit that cannot be authored.
 */
export function guestGitIdentityCommand(identity: GitIdentity): string {
	const lines: string[] = []
	for (const { field, configKey } of IDENTITY_FIELDS) {
		const configuredValue = identity[field]
		if (!configuredValue) continue
		lines.push(guestKeyCommand({ configKey, configuredValue }))
	}
	return lines.join('\n')
}

export interface GuestIdentityInput {
	/** pi's own local shell: the boundary the host-side read borrows. */
	hostOps: BashOperations
	/** The worktree whose identity the host resolves, host-side. */
	worktreePath: string
	/** How the exec boundary reaches the workspace. */
	guest: GuestTarget
	/** The mounted worktree in the guest, and where the identity read runs. */
	workdir: string
	ownerSession: string
}

/**
 * Give the guest the identity this worktree's commits carry on the host. A host that has no
 * identity either inherits nothing: the guest is then as identity-less as the host, which is
 * the human's own git configuration to fix, never an identity for a session to invent.
 */
export async function inheritGuestGitIdentity(
	input: GuestIdentityInput,
): Promise<GuestIdentityOutcome> {
	const identity = await hostGitIdentity(input.hostOps, input.worktreePath)
	if (!identity.name && !identity.email) return { kind: 'unchanged' }
	const chunks: Buffer[] = []
	const run = await execInContainer(
		input.guest,
		input.workdir,
		guestGitIdentityCommand(identity),
		{
			timeoutSeconds: GUEST_CONTROL_TIMEOUT_SECONDS,
			ownerSession: input.ownerSession,
			onData: chunk => chunks.push(chunk),
		},
	)
	if (run.exitCode !== 0) {
		throw new Error(
			`the guest's git config refused the identity (exit ${run.exitCode})`,
		)
	}
	const didWrite = Buffer.concat(chunks)
		.toString('utf-8')
		.includes(GUEST_IDENTITY_MARKER)
	return didWrite ? { kind: 'inherited', identity } : { kind: 'unchanged' }
}
