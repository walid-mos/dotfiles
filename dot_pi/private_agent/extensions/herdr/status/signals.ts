/** Signal contracts for Herdr's pane reports and Pi's herdr events. */
interface BlockedSignal {
	active: boolean
	label?: string
}

interface BusySignal {
	active: boolean
}

interface AgentRecord {
	pane_id?: string
	agent_status?: string
}

interface AgentListResponse {
	result?: {
		agents?: AgentRecord[]
	}
}

export function isBlockedSignal(signal: unknown): signal is BlockedSignal {
	return typeof signal === 'object' && signal !== null && 'active' in signal
}

export function isBusySignal(signal: unknown): signal is BusySignal {
	return typeof signal === 'object' && signal !== null && 'active' in signal
}

export function herdrPaneStatusFrom(
	stdoutDocument: string,
	paneId: string,
): string | undefined {
	let parsed: unknown
	try {
		parsed = JSON.parse(stdoutDocument)
	} catch {
		return undefined
	}
	if (!isAgentListResponse(parsed)) return undefined
	const agents = parsed.result?.agents
	if (!agents) return undefined
	const mine = agents.find(record => record?.pane_id === paneId)
	if (!mine?.agent_status) return undefined
	return mine.agent_status
}

function isAgentListResponse(envelope: unknown): envelope is AgentListResponse {
	if (
		typeof envelope !== 'object' ||
		envelope === null ||
		!('result' in envelope)
	)
		return false
	const wrapped: unknown = envelope.result
	if (
		typeof wrapped !== 'object' ||
		wrapped === null ||
		!('agents' in wrapped)
	)
		return false
	return Array.isArray(wrapped.agents)
}
