// The devvm vehicle: workspaces as network namespaces on one shared Apple
// container VM, instead of one VM per worktree. wt owns the topology (the VM,
// the namespaces, the users, the relays); this module only mirrors the parts of
// that contract the exec boundary needs to run a command inside a workspace:
// the VM's name and state paths, and the argv shape of `wt sh`'s devvm branch
// (lib/sh.sh wt_sh_devvm), so the extension and wt enter the same way - same
// namespace, same /workspace bind, same workspace user.
//
// Two properties of the VM shape everything here: the namespace has no egress
// (installs run in the VM root namespace, wt handles them at provisioning), and a
// bind mount carries no submounts - the install sits on a root-namespace bind over
// the tree's node_modules, so the entry script binds it again after the tree bind.
import { runCapture } from './container-cli.ts'
import { guestSessionScript } from './exec-session.ts'
import { GUEST_WORKDIR } from './sandbox-prompt.ts'

/**
 * The dev VM's name - wt's own constant (`WT_DEVVM_NAME`, lib/devvm-vm.sh).
 * Mirrored, not read: the value is wt's identity for the machine, and asking
 * wt (`wt devvm status`) boots the VM as a side effect.
 */
export const DEVVM_NAME = 'wt-dev'

/** Per-workspace state on VM disk (`WT_DEVVM_WS_ROOT`): index, tree path, veth records. */
export const DEVVM_WS_ROOT = '/srv/ws'

/** Per-workspace runtime state (`WT_DEVVM_RUN_ROOT`): pidfiles and the tailscale socket. */
export const DEVVM_RUN_ROOT = '/run/wt'

/** Reading one fact from the VM must never hang the session start. */
const DEVVM_READ_TIMEOUT_SECONDS = 15

/**
 * The guest user a workspace runs as: `wt-<workspace name>`. The name compounds
 * (`wt-` + a name that usually starts `wt-`) - a recorded cosmetic gap, kept
 * because it is the identity wt provisioned.
 */
export function devvmUser(workspaceName: string): string {
	return `wt-${workspaceName}`
}

/**
 * The part of a /workspace-rooted workdir below the bind: the devvm exec chain
 * has no `-w` flag (the workdir lives inside a namespace), so the subpath rides
 * as an argument to the `cd` in the entry script.
 */
export function devvmSubpath(workdir: string): string {
	if (workdir === GUEST_WORKDIR) return ''
	if (workdir.startsWith(`${GUEST_WORKDIR}/`)) {
		return workdir.slice(GUEST_WORKDIR.length)
	}
	return ''
}

/**
 * The entry script every devvm guest call runs inside the namespace, as `sh -c`
 * receives it. Same contract as wt sh's devvm branch: bind the tree at
 * /workspace in a private mount namespace, land in the session's workdir, source
 * the environment wt published for the workspace, then drop to the workspace user
 * for the call itself. `$1` is the guest session wrapper (pidfile handshake,
 * setsid, timeout), so the ownership machinery of the container flow applies
 * unchanged; `$9` is that environment file.
 */
const DEVVM_ENTRY_SCRIPT = [
	'mkdir -p /workspace',
	'mount --bind "$2" /workspace || exit 1',
	'mkdir -p /workspace/node_modules',
	'mount --bind "$8" /workspace/node_modules || exit 1',
	'cd "/workspace$3" || exit 1',
	// The environment wt published for this workspace (the project's declarations and the
	// workspace's own tailnet name), sourced before the user switch so the call and everything it
	// starts inherit it. Missing is not an error: the call runs without it.
	'[ ! -r "$9" ] || { set -a; . "$9"; set +a; }',
	'exec runuser -u "$4" -- sh -c "$1" wt-exec "$5" "$6" "$7"',
].join('\n')

/** The full `container` argv for one guest call in a devvm workspace. */
export function devvmExecArgv(input: {
	workspaceName: string
	treePath: string
	subpath: string
	token: string
	deadlineSeconds: number
	command: string
}): string[] {
	const {
		workspaceName,
		treePath,
		subpath,
		token,
		deadlineSeconds,
		command,
	} = input
	return [
		'exec',
		DEVVM_NAME,
		'ip',
		'netns',
		'exec',
		workspaceName,
		'unshare',
		'--mount',
		'sh',
		'-c',
		DEVVM_ENTRY_SCRIPT,
		'wt-devvm',
		guestSessionScript(),
		treePath,
		subpath,
		devvmUser(workspaceName),
		token,
		String(deadlineSeconds),
		command,
		`${DEVVM_WS_ROOT}/${workspaceName}/nm`,
		devvmEnvironmentPath(workspaceName),
	]
}

/** The `container` argv of a command in the VM's root namespace, where no workspace owns the view. */
export function devvmRootExecArgv(args: readonly string[]): string[] {
	return ['exec', DEVVM_NAME, ...args]
}

/** The `container` argv that succeeds only when the workspace's namespace answers. */
export function devvmProbeArgv(workspaceName: string): string[] {
	return devvmRootExecArgv(['ip', 'netns', 'exec', workspaceName, 'true'])
}

/**
 * Where the workspace's tree lives inside the VM, as wt recorded it
 * (`/srv/ws/<name>/tree` holds the VM-side path). Read once per session:
 * this is the one fact the exec chain cannot derive on its own, and the read
 * is side-effect-free - `container exec` never boots a stopped VM, it fails.
 */
export async function readDevvmTreePath(
	workspaceName: string,
): Promise<string | null> {
	let run
	try {
		run = await runCapture(
			devvmRootExecArgv([
				'cat',
				`${DEVVM_WS_ROOT}/${workspaceName}/tree`,
			]),
			DEVVM_READ_TIMEOUT_SECONDS,
		)
	} catch {
		return null
	}
	if (run.exitCode !== 0) return null
	const treePath = run.stdout.trim()
	if (!treePath.startsWith('/') || /\s/u.test(treePath)) return null
	return treePath
}

/**
 * The environment wt publishes for one workspace (`lib/devvm-workspace.sh` owns
 * its contents): sourced by every entry into the workspace, never parsed here.
 */
export function devvmEnvironmentPath(workspaceName: string): string {
	return `${DEVVM_RUN_ROOT}/${workspaceName}/env`
}

/**
 * Has wt published that environment yet? The only fact the exec boundary asks
 * of it - the guest entry sources the file itself, so nothing here reads its
 * contents - and the one a workspace wt never published one for answers no to,
 * which is what a session reconciles through wt (`wt sync` is the idempotent
 * add). Side-effect-free, like the tree read above.
 */
export async function devvmEnvironmentPublished(
	workspaceName: string,
): Promise<boolean> {
	let run
	try {
		run = await runCapture(
			devvmRootExecArgv([
				'sh',
				'-c',
				'test -r "$1"',
				'wt-env',
				devvmEnvironmentPath(workspaceName),
			]),
			DEVVM_READ_TIMEOUT_SECONDS,
		)
	} catch {
		return false
	}
	return run.exitCode === 0
}
