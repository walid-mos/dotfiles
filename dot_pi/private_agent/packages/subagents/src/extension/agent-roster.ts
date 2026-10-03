import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverAgentSnapshot } from "../agents/agents.ts";
import type { AgentConfig, AgentDiscoveryOptions, AgentSource } from "../agents/agents.ts";

/**
 * Read-only agent roster for sibling Pi extensions (the `/models` picker in
 * `extensions/model/fallback/agent-roster.ts` reads it to list every agent it
 * can pin, not just the ones with a settings override).
 *
 * The event carries a plain-JSON request whose `result` field the installed
 * pi-subagents runtime fills in synchronously. The roster is the same
 * discovery projection the launch path uses - `discoverAgentSnapshot` with
 * every settings layer already merged - so a surface that renders it cannot
 * drift from what a launch runs. Requests from a different protocol version
 * are answered with an error instead of a partial roster, so a caller never
 * reads stale field semantics.
 */
export const AGENT_ROSTER_EVENT = "pi-subagents:agent-roster:v1";
export const AGENT_ROSTER_VERSION = 1 as const;

/** Where the model an agent runs comes from, before session inheritance. */
export type AgentRosterModelOrigin =
	/** `subagents.agentOverrides.<agent>.model` in a settings file. */
	| "override"
	/** The agent definition's own frontmatter. */
	| "agent"
	/** `subagents.defaultModel`, applied to every agent that sets none. */
	| "default";

export interface AgentRosterAgent {
	name: string;
	description: string;
	aliases: string[];
	source: AgentSource;
	filePath: string;
	/** The configured model, before a child would inherit the session's. */
	model?: string;
	/** Set exactly when `model` is. */
	modelOrigin?: AgentRosterModelOrigin;
	/** The settings scope that supplied an override or the default model. */
	modelScope?: "user" | "project";
	/** The settings file that supplied an override or the default model. */
	modelPath?: string;
	/** True when nothing configures a model, so a launch would inherit. */
	inheritsModel: boolean;
	/** The configured thinking level, before per-model clamping. */
	thinking?: string;
	thinkingOrigin?: "override" | "agent";
	thinkingScope?: "user" | "project";
	thinkingPath?: string;
	/** True when the agent sets no level of its own. */
	inheritsThinking: boolean;
}

export interface AgentRosterPayload {
	version: typeof AGENT_ROSTER_VERSION;
	cwd: string;
	agents: AgentRosterAgent[];
	/** `subagents.maxThinking`, the ceiling every child level is clamped by. */
	maxThinking?: string;
	/** The settings files the package read for this roster, in precedence order. */
	settingsPaths: { user: string; project: string | null };
}

export interface AgentRosterRequest {
	version: typeof AGENT_ROSTER_VERSION;
	cwd: string;
	/** The session's provider, selecting provider-specific settings overrides as a launch does. */
	preferredModelProvider?: string;
	/** Filled in by the installed runtime; a caller never sets it. */
	result?: AgentRosterPayload | { error: string };
}

type AgentOverrideInfo = NonNullable<AgentConfig["override"]>;

function overrideSets(override: AgentOverrideInfo | undefined, field: string): boolean {
	return override?.fields?.includes(field) === true;
}

/**
 * The model fact of one agent. A settings pin wins over the agent's own
 * frontmatter, and `subagents.defaultModel` sits below both - the same order
 * the discovery merge applies, read back from the merge's own bookkeeping
 * (`override.fields`, `modelSource`) instead of re-deriving it from settings.
 */
function modelFact(agent: AgentConfig): Pick<AgentRosterAgent, "model" | "modelOrigin" | "modelScope" | "modelPath" | "inheritsModel"> {
	const override = agent.override;
	if (agent.model !== undefined) {
		if (overrideSets(override, "model") && override) {
			return { model: agent.model, modelOrigin: "override", modelScope: override.scope, modelPath: override.path, inheritsModel: false };
		}
		if (agent.modelSource) {
			return { model: agent.model, modelOrigin: "default", modelScope: agent.modelSource.scope, modelPath: agent.modelSource.path, inheritsModel: false };
		}
		return { model: agent.model, modelOrigin: "agent", inheritsModel: false };
	}
	// A pin that wrote `false` means "inherit", and reads as such here: the
	// model key is gone and nothing else supplies one.
	return { inheritsModel: true };
}

/**
 * The thinking fact of one agent, read the same way. `subagents.disableThinking`
 * removes the level without recording an override field, so an agent cleared
 * that way reports no level of its own - which is exactly what a launch runs.
 */
function thinkingFact(agent: AgentConfig): Pick<AgentRosterAgent, "thinking" | "thinkingOrigin" | "thinkingScope" | "thinkingPath" | "inheritsThinking"> {
	const override = agent.override;
	// A `false` level means "no reasoning level" - the same fact as no level at
	// all for a reader deciding whether the agent sets one of its own.
	if (agent.thinking === undefined || agent.thinking === false) return { inheritsThinking: true };
	if (overrideSets(override, "thinking") && override) {
		return { thinking: agent.thinking, thinkingOrigin: "override", thinkingScope: override.scope, thinkingPath: override.path, inheritsThinking: false };
	}
	return { thinking: agent.thinking, thinkingOrigin: "agent", inheritsThinking: false };
}

/** One agent as the roster reports it: what it is, and what it would run. */
function rosterAgent(agent: AgentConfig): AgentRosterAgent {
	return {
		name: agent.name,
		description: agent.description,
		aliases: [...(agent.aliases ?? [])],
		source: agent.source,
		filePath: agent.filePath,
		...modelFact(agent),
		...thinkingFact(agent),
	};
}

/**
 * Every agent the launch path would resolve in `cwd`, with the settings layers
 * already merged. Disabled agents are left out: they cannot run, so a pin on
 * one would be a stored value nothing reads.
 */
export function buildAgentRoster(cwd: string, preferredModelProvider?: string, options: AgentDiscoveryOptions = {}): AgentRosterPayload {
	const snapshot = discoverAgentSnapshot(cwd, "both", preferredModelProvider, options);
	const { userSettingsPath, projectSettingsPath } = snapshot.all;
	return {
		version: AGENT_ROSTER_VERSION,
		cwd,
		agents: snapshot.effective.agents.filter((agent) => agent.disabled !== true).map(rosterAgent),
		...(snapshot.effective.maxThinking ? { maxThinking: snapshot.effective.maxThinking } : {}),
		settingsPaths: { user: userSettingsPath, project: projectSettingsPath },
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export interface AgentRosterListenerDeps {
	/**
	 * The global package root the launch path resolved, read per request. When
	 * provided, the roster reads the same packages and discovery cache entry as
	 * launches instead of running its own blocking `npm root -g` lookup.
	 */
	globalNpmRoot?: () => string | null | undefined;
}

/** Answer roster requests for this Pi process until the returned disposer runs. */
export function registerAgentRosterListener(pi: ExtensionAPI, deps: AgentRosterListenerDeps = {}): () => void {
	return pi.events.on(AGENT_ROSTER_EVENT, (rawRequest) => {
		if (!rawRequest || typeof rawRequest !== "object" || Array.isArray(rawRequest)) return;
		const request = rawRequest as Record<string, unknown>;
		if (request.result !== undefined) return;
		try {
			if (request.version !== AGENT_ROSTER_VERSION) {
				throw new Error(`Unsupported agent roster event version '${String(request.version)}'.`);
			}
			if (typeof request.cwd !== "string" || !request.cwd.trim()) {
				throw new Error("Agent roster requests need a non-empty cwd.");
			}
			if (request.preferredModelProvider !== undefined && typeof request.preferredModelProvider !== "string") {
				throw new Error("Agent roster provider must be a string.");
			}
			const options: AgentDiscoveryOptions = deps.globalNpmRoot ? { globalNpmRoot: deps.globalNpmRoot() } : {};
			request.result = buildAgentRoster(request.cwd, request.preferredModelProvider, options) satisfies AgentRosterPayload;
		} catch (error) {
			request.result = { error: errorMessage(error) } satisfies { error: string };
		}
	});
}
