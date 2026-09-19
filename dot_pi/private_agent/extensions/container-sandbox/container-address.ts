// The addresses a session may hand out or dial: the VM's own IP, the host as the VM
// addresses it, and the workspace's MagicDNS name. Read from the runtime's inventory or from
// the node itself, never assumed - the bridge subnet is the runtime's choice, and a
// workspace that never answers reports no name instead of a wrong one. Reads only: nothing
// here creates, starts or stops anything (container.ts owns the guest calls themselves).
import { spawnSync } from 'node:child_process'

import { CONTAINER_BIN, runCapture } from './container-cli.ts'
import { PROBE_PATIENT_SECONDS } from './container.ts'
import { DEVVM_RUN_ROOT, devvmRootExecArgv } from './devvm.ts'

/** Host-side address of a running container, for servers the host must reach. */
export function bestEffortContainerIp(containerName: string): string | null {
	const listing = spawnSync(CONTAINER_BIN, ['list'], { encoding: 'utf-8' })
	if (listing.status !== 0 || typeof listing.stdout !== 'string') return null
	const ownLine = listing.stdout
		.split('\n')
		.find(line => line.includes(containerName))
	return ownLine?.match(/(\d{1,3}(?:\.\d{1,3}){3})/)?.[1] ?? null
}

/** Only the inventory fields this module reads; the runtime's schema is not ours to model. */
interface ContainerEntry {
	id: string
	status: { networks?: { ipv4Gateway?: string }[] }
}

function isContainerEntry(candidate: unknown): candidate is ContainerEntry {
	if (typeof candidate !== 'object' || candidate === null) return false
	if (!('id' in candidate) || typeof candidate.id !== 'string') return false
	return (
		'status' in candidate &&
		typeof candidate.status === 'object' &&
		candidate.status !== null
	)
}

/**
 * The host as the VM addresses it. Read from the runtime's inventory instead of assumed:
 * the bridge subnet is the runtime's choice, and a hardcoded gateway sends the model - and
 * the human - to an address nothing answers on a machine that picked another subnet.
 */
export function gatewayFromInventory(
	inventory: string,
	containerName: string,
): string | null {
	let parsed: unknown
	try {
		parsed = JSON.parse(inventory)
	} catch {
		return null
	}
	if (!Array.isArray(parsed)) return null
	for (const entry of parsed) {
		if (!isContainerEntry(entry) || entry.id !== containerName) continue
		const gateway = entry.status.networks?.[0]?.ipv4Gateway
		if (typeof gateway === 'string' && gateway) return gateway
	}
	return null
}

export function bestEffortHostGateway(containerName: string): string | null {
	const listing = spawnSync(CONTAINER_BIN, ['list', '--format', 'json'], {
		encoding: 'utf-8',
	})
	if (listing.status !== 0 || typeof listing.stdout !== 'string') return null
	return gatewayFromInventory(listing.stdout, containerName)
}

/**
 * The MagicDNS name the workspace's node reports for itself, or null when it is not on the
 * tailnet. The node's own view is the authority - a tailnet that had to uniquify the name
 * answers on the suffixed one, which no host-side inventory can tell apart from the plain one.
 */
export function tailnetHostFromStatus(status: string): string | null {
	let parsed: unknown
	try {
		parsed = JSON.parse(status)
	} catch {
		return null
	}
	if (typeof parsed !== 'object' || parsed === null) return null
	const self: unknown = Reflect.get(parsed, 'Self')
	if (typeof self !== 'object' || self === null) return null
	const dnsName: unknown = Reflect.get(self, 'DNSName')
	if (typeof dnsName !== 'string') return null
	const host = dnsName.replace(/\.$/u, '')
	return host || null
}

/**
 * Best-effort tailnet name, read once per activation: this is the only address a human can
 * open, so a workspace that never answers is reported as having none instead of a wrong one.
 * The patient budget is the same one a cold VM gets, because the answer only exists once the
 * node is up.
 */
export async function bestEffortTailnetHost(
	containerName: string,
): Promise<string | null> {
	try {
		const run = await runCapture(
			['exec', containerName, 'tailscale', 'status', '--json'],
			PROBE_PATIENT_SECONDS,
		)
		if (run.exitCode !== 0) return null
		return tailnetHostFromStatus(run.stdout)
	} catch {
		return null
	}
}

/**
 * Best-effort tailnet name for a devvm workspace. Its tailscaled runs in the
 * dev VM's root namespace behind the workspace's own socket (a namespace has
 * no egress, so the node cannot live inside it), and status is a read: the
 * daemon is never started to answer it.
 */
export async function bestEffortDevvmTailnetHost(
	workspaceName: string,
): Promise<string | null> {
	try {
		const run = await runCapture(
			devvmRootExecArgv([
				'tailscale',
				`--socket=${DEVVM_RUN_ROOT}/${workspaceName}/tailscaled.sock`,
				'status',
				'--json',
			]),
			PROBE_PATIENT_SECONDS,
		)
		if (run.exitCode !== 0) return null
		return tailnetHostFromStatus(run.stdout)
	} catch {
		return null
	}
}
