/**
 * model-fallback - the agent roster the `subagents` package publishes, read
 * over pi's own in-process event bus.
 *
 * The picker edits agent pins, so it has to name the agents that exist: the
 * settings file lists only the ones already pinned, and a pin can outlive the
 * agent it names. The `subagents` package owns discovery, so this module asks
 * it (`pi-subagents:agent-roster:v1`, produced by `src/extension/agent-roster.ts`
 * of that package) instead of scanning agent directories here - one discovery
 * path for both surfaces.
 *
 * The payload crosses a package boundary, so its shape is declared once
 * (typebox) and parsed at this boundary: an older or missing package leaves the
 * picker on the pins it can read itself, and an answer that does not match is
 * treated exactly like no answer.
 */

import { Type } from 'typebox'
import { Value } from 'typebox/value'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { Static } from 'typebox'

/** The event `pi-subagents` answers; its producer owns the payload's version. */
export const AGENT_ROSTER_EVENT = 'pi-subagents:agent-roster:v1'

const AGENT_ROSTER_VERSION = 1

const RosterAgentSchema = Type.Object({
	name: Type.String({ minLength: 1 }),
	description: Type.String(),
	aliases: Type.Array(Type.String()),
	source: Type.String(),
	filePath: Type.String(),
	model: Type.Optional(Type.String()),
	modelOrigin: Type.Optional(
		Type.Union([
			Type.Literal('override'),
			Type.Literal('agent'),
			Type.Literal('default'),
		]),
	),
	modelScope: Type.Optional(
		Type.Union([Type.Literal('user'), Type.Literal('project')]),
	),
	modelPath: Type.Optional(Type.String()),
	fallbackModels: Type.Optional(Type.Array(Type.String())),
	inheritsModel: Type.Boolean(),
	thinking: Type.Optional(Type.String()),
	thinkingOrigin: Type.Optional(
		Type.Union([Type.Literal('override'), Type.Literal('agent')]),
	),
	thinkingScope: Type.Optional(
		Type.Union([Type.Literal('user'), Type.Literal('project')]),
	),
	inheritsThinking: Type.Boolean(),
})

const RosterPayloadSchema = Type.Object({
	version: Type.Literal(AGENT_ROSTER_VERSION),
	cwd: Type.String(),
	agents: Type.Array(RosterAgentSchema),
	maxThinking: Type.Optional(Type.String()),
	settingsPaths: Type.Object({
		user: Type.String(),
		project: Type.Union([Type.String(), Type.Null()]),
	}),
})

export type RosterAgent = Static<typeof RosterAgentSchema>
export type AgentRoster = Omit<Static<typeof RosterPayloadSchema>, 'agents'> & {
	agents: readonly RosterAgent[]
}

interface AgentRosterRequest {
	version: typeof AGENT_ROSTER_VERSION
	cwd: string
	result?: unknown
}

/**
 * Ask the installed `subagents` package for its roster. The bus is synchronous
 * - the package fills `result` before `emit` returns - so this neither awaits
 * nor blocks a render: it runs once when the picker builds its view.
 * `undefined` means nobody answered (not installed, not ready, older version,
 * or an answer this reader refuses), and the picker falls back to the pins.
 */
export function readAgentRoster(
	pi: Pick<ExtensionAPI, 'events'>,
	cwd: string,
): AgentRoster | undefined {
	// The event bus is optional here: without it (an older pi, a test double)
	// the picker still opens, it just cannot see the agents behind the pins.
	if (!pi.events || typeof pi.events.emit !== 'function') return undefined
	const request: AgentRosterRequest = { version: AGENT_ROSTER_VERSION, cwd }
	pi.events.emit(AGENT_ROSTER_EVENT, request)
	try {
		return Value.Parse(RosterPayloadSchema, request.result)
	} catch {
		return undefined
	}
}
