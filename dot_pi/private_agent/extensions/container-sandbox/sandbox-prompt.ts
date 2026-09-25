// The sandbox section of the system prompt, built from facts a test can stage: where bash
// actually runs, what that costs, and - the part a model gets wrong on its own - which address
// it may hand a human. A service started in the VM listens on the VM's localhost, which
// resolves to nothing on the human's machine, so the only address reported is the workspace's
// own tailnet name, and a workspace without one is said to have no link rather than a
// localhost link that cannot work. The text is pure: session.ts reads the facts.
import type { Vehicle } from './wt.ts'

export const GUEST_WORKDIR = '/workspace'

export interface SandboxFacts {
	/** The VM's own name, as wt recorded it. */
	containerName: string
	/** How wt provisioned the workspace; the devvm text says namespace, not VM. */
	vehicle?: Vehicle
	/** The worktree on the host, mounted at GUEST_WORKDIR. */
	workspacePath: string
	/** Host ports published by `container run`. */
	ports: string[]
	/** Reserved memory, empty when the row predates the setting. */
	memory: string
	/** The host address of the VM, null when the runtime cannot say. */
	ip: string | null
	/** The host as the VM addresses it, null when unknown. */
	gateway: string | null
	/** The workspace's own tailnet node name, null when it is not on the tailnet. */
	tailnetHost: string | null
	/** Ports the project publishes on that node. */
	tailnetPorts: number[]
	/** The port of wt's workspace index, null when the project reserves none. */
	tailnetIndex: number | null
}

/**
 * The addresses a human can open, as a prohibition plus the address to use instead: a model
 * that only learns where a service listens reports the VM's own localhost, which resolves to
 * nothing on the human's machine. A workspace with no node, or with no declared port, is said
 * to have no link rather than given one that cannot work. The index is named where it exists: it
 * is the one address that lists what is listening, including a port nobody declared.
 */
export function tailnetAddressGuidance(
	host: string | null,
	ports: readonly number[],
	index: number | null = null,
): string {
	const rule =
		"**Addresses for the human.** Never report a `localhost` link or this VM's container IP to the human: nothing on their machine answers there."
	if (!host) {
		return `${rule} This workspace reported no tailnet node of its own, so it has no address they can open - say that (\`/container status\` shows the state) instead of handing over a localhost link.`
	}
	const answers = `It answers on the tailnet as \`${host}\`, so a link for the human is \`https://${host}:<port>\``
	if (!ports.length) {
		return `${rule} ${answers}, but no port is declared for it yet, so nothing is served to them: say so instead of linking to localhost, and a port that must be reachable belongs in the project's \`tailscale.ports\`.${pageSummary(host, index)}`
	}
	const links = ports
		.map((port): string => `https://${host}:${port}`)
		.join(', ')
	return `${rule} ${answers} with the port that app listens on: ${links}. Those are the ports the project declares - a port outside that list is not on the tailnet, so name it as unreachable rather than linking to localhost - and \`localhost:<port>\` stays correct for your own commands inside the VM.${pageSummary(host, index)}`
}

/** The workspace index, as the live list of what the VM serves - empty when none is declared. */
function pageSummary(host: string, index: number | null): string {
	if (index === null) return ''
	return ` The workspace index at \`https://${host}:${index}\` is the live list of what that VM is serving right now, declared or not: send them there when the address they want is not among the declared ports.`
}

/** How the guest reaches the project's host-side services, by vehicle and gateway. */
function hostServicesLine(facts: SandboxFacts): string {
	if (facts.vehicle === 'devvm') {
		return "The project's host-side services (database, Keycloak, MinIO) are relayed by wt onto this workspace's own localhost, so your own commands reach them at localhost:<port>; other network traffic uses the namespace's default route."
	}
	if (facts.gateway) {
		return `The project's host-side services (database, Keycloak, MinIO) are relayed by wt onto this VM's own localhost, so your own commands reach them at localhost:<port>; anything wt does not relay is reachable at ${facts.gateway}:<port>.`
	}
	return `The project's host-side services are relayed by wt onto this VM's own localhost, so your own commands reach them at localhost:<port>; anything wt does not relay is reachable through the VM's default gateway, whichever address \`ip route show default\` reports.`
}

/** The sandbox section of the system prompt, built from facts so a test can stage any workspace. */
export function sandboxPromptSection(facts: SandboxFacts): string {
	const devvm = facts.vehicle === 'devvm'
	const intro = devvm
		? `Bash commands run inside the workspace's namespace on the shared dev VM (\`${facts.containerName}\` on wt-dev), NOT on the macOS host.`
		: `Bash commands run inside an Apple container VM (\`${facts.containerName}\`), NOT on the macOS host.`
	const portLine =
		!devvm && facts.ports.length > 0
			? ` also on the host at ${facts.ports.join(', ')}`
			: ''
	// Host services keep their localhost relay contract while other traffic uses the
	// namespace's forwarded default route. The tailnet serve path reaches a dev server
	// through the workspace's veth, which is why the 0.0.0.0 rule survives the vehicle change.
	const hostServices = hostServicesLine(facts)
	const reach = devvm
		? "A server the tailnet must reach through this namespace's veth has to listen on 0.0.0.0, not only loopback (nothing is published to the host from here). The workspace's environment is already published into your calls - its own tailnet name among it - so a dev server you start accepts the name the human opens."
		: `A server the host must reach at http://${facts.ip ?? '<container-ip>'}:<port> has to listen on 0.0.0.0, not only loopback${portLine}.`
	const competition = devvm
		? 'Commands left running here compete with every later one and with every other workspace on the shared dev VM'
		: 'Commands left running here compete with every later one for a small VM'
	return `## Sandbox environment
${intro} The worktree ${facts.workspacePath} is mounted at ${GUEST_WORKDIR} and the current directory is already inside it; nothing else of the host exists there (/Users, /Applications, brew, osascript, the macOS home). Use the \`host\` tool for macOS administration, and the \`read\`/\`edit\`/\`write\`/\`ls\`/\`grep\`/\`find\` tools for project files (they run host-side on the same bytes through the mount, and \`tool-guard\` refuses the bash forms).
The VM has its own localhost, ports and network stack, so servers started here never conflict with other workspaces. ${reach} ${hostServices}
${tailnetAddressGuidance(facts.tailnetHost, facts.tailnetPorts, facts.tailnetIndex)}
${competition}${facts.memory ? ` (${facts.memory})` : ''}, and a starved VM stops answering altogether: never keep a dev server next to a full typecheck or build, and detach long work instead of waiting on it. Every pi session whose worktree maps to this container shares the same VM, so check /container status before starting heavy work; a call that times out or is interrupted is killed with its whole guest process tree, which is why nothing may be left running by accident.`
}
