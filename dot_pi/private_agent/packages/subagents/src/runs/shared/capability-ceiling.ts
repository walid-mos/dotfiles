import { Buffer } from "node:buffer";

export const SUBAGENT_CAPABILITY_CEILING_VERSION = 1 as const;

export type SubagentCapabilityCeiling =
	| { allowedTools: readonly string[]; allowedAgents?: readonly string[]; denyExtensions?: boolean }
	| { allowedTools?: readonly string[]; allowedAgents?: readonly string[]; denyExtensions: boolean }
	| { allowedTools?: readonly string[]; allowedAgents: readonly string[]; denyExtensions?: boolean };

export interface ResolvedSubagentCapabilityCeiling {
	version: typeof SUBAGENT_CAPABILITY_CEILING_VERSION;
	allowedTools?: string[];
	allowedAgents?: string[];
	denyExtensions: boolean;
	sources: string[];
}

export interface SubagentCapabilityAudit {
	ceiling: ResolvedSubagentCapabilityCeiling;
	requestedTools?: string[];
	effectiveTools: string[];
	removedTools: string[];
	excludeTools?: string[];
	internalTools: string[];
	extensionsDenied: boolean;
	removedExtensionCount: number;
	requestedMcpToolCount: number;
	effectiveMcpTools: string[];
	agentAllowed: boolean;
	agentRestrictionSources?: string[];
	/** Builtin tools declared but unavailable on the host runtime. */
}

function validateText(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f\u007f]/u.test(value) || Buffer.byteLength(value.trim(), "utf8") > 256) {
		throw new Error(`Invalid capability ceiling ${field}; expected a non-empty string without control characters (max 256 UTF-8 bytes).`);
	}
	return value.trim();
}

export function normalizeCapabilityCeilingAllowedAgents(values: unknown): string[] {
	return normalizeCeiling({ allowedAgents: values } as SubagentCapabilityCeiling).allowedAgents!;
}

function normalizeCeiling(ceiling: SubagentCapabilityCeiling): ResolvedSubagentCapabilityCeiling {
	if (!ceiling || typeof ceiling !== "object" || Array.isArray(ceiling)) throw new Error("Invalid capability ceiling; expected an object.");
	const hasAllowedTools = Object.hasOwn(ceiling, "allowedTools");
	const hasAllowedAgents = Object.hasOwn(ceiling, "allowedAgents");
	const hasDenyExtensions = Object.hasOwn(ceiling, "denyExtensions");
	if (!hasAllowedTools && !hasAllowedAgents && !hasDenyExtensions) throw new Error("Invalid capability ceiling; expected allowedTools, allowedAgents, or denyExtensions.");
	if (hasDenyExtensions && typeof ceiling.denyExtensions !== "boolean") throw new Error("Invalid capability ceiling denyExtensions; expected a boolean.");
	const normalizeList = (field: "allowedTools" | "allowedAgents", pattern: RegExp): string[] | undefined => {
		if (!Object.hasOwn(ceiling, field)) return undefined;
		const values = ceiling[field];
		if (!Array.isArray(values)) throw new Error(`Invalid capability ceiling ${field}; expected an array.`);
		if (values.length > 256) throw new Error(`Invalid capability ceiling ${field}; expected at most 256 names.`);
		return [...new Set(values.map((entry) => {
			const name = validateText(entry, `${field} entry`);
			if (!pattern.test(name)) throw new Error(`Invalid capability ceiling ${field} entry '${name}'.`);
			if (Buffer.byteLength(name, "utf8") > 128) throw new Error(`Invalid capability ceiling ${field} entry '${name}'; max 128 UTF-8 bytes.`);
			return name;
		}))].sort();
	};
	const allowedTools = normalizeList("allowedTools", /^[A-Za-z0-9_.:-]+$/u);
	const allowedAgents = normalizeList("allowedAgents", /^[A-Za-z0-9_.:-]+$/u);
	return {
		version: SUBAGENT_CAPABILITY_CEILING_VERSION,
		...(allowedTools !== undefined ? { allowedTools } : {}),
		...(allowedAgents !== undefined ? { allowedAgents } : {}),
		denyExtensions: ceiling.denyExtensions === true,
		sources: [],
	};
}

export function parseSubagentCapabilityCeiling(value: unknown, field = "capability ceiling"): ResolvedSubagentCapabilityCeiling {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${field}; expected an object.`);
	const record = value as Record<string, unknown>;
	if (record.version !== SUBAGENT_CAPABILITY_CEILING_VERSION) throw new Error(`Invalid ${field} version.`);
	const normalized = normalizeCeiling(record as SubagentCapabilityCeiling);
	const sources = record.sources;
	if (!Array.isArray(sources) || sources.some((source) => typeof source !== "string")) throw new Error(`Invalid ${field} sources; expected an array of strings.`);
	normalized.sources = [...new Set(sources.map((source) => validateText(source, `${field} source`)))].sort();
	return normalized;
}

export function intersectSubagentCapabilityCeilings(...ceilings: Array<ResolvedSubagentCapabilityCeiling | undefined>): ResolvedSubagentCapabilityCeiling | undefined {
	const active = ceilings.filter((ceiling): ceiling is ResolvedSubagentCapabilityCeiling => ceiling !== undefined);
	if (active.length === 0) return undefined;
	const intersectLists = (field: "allowedTools" | "allowedAgents"): string[] | undefined => {
		const definedLists = active.filter((ceiling) => ceiling[field] !== undefined).map((ceiling) => new Set(ceiling[field]));
		if (definedLists.length === 0) return undefined;
		return [...definedLists[0]!].filter((entry) => definedLists.every((list) => list.has(entry))).sort();
	};
	const allowedTools = intersectLists("allowedTools");
	const allowedAgents = intersectLists("allowedAgents");
	return {
		version: SUBAGENT_CAPABILITY_CEILING_VERSION,
		...(allowedTools !== undefined ? { allowedTools } : {}),
		...(allowedAgents !== undefined ? { allowedAgents } : {}),
		denyExtensions: active.some((ceiling) => ceiling.denyExtensions),
		sources: [...new Set(active.flatMap((ceiling) => ceiling.sources))].sort(),
	};
}

export function isAgentAllowedByCapabilityCeiling(agentName: string, ceiling: ResolvedSubagentCapabilityCeiling | undefined): boolean {
	return ceiling?.allowedAgents === undefined || ceiling.allowedAgents.includes(agentName);
}

export function capabilityCeilingAgentRestrictionMessage(agentName: string, ceiling: ResolvedSubagentCapabilityCeiling | undefined): string | undefined {
	if (isAgentAllowedByCapabilityCeiling(agentName, ceiling)) return undefined;
	const sources = ceiling?.sources.length ? ceiling.sources.join(", ") : "unknown source";
	const allowed = ceiling?.allowedAgents?.length ? ceiling.allowedAgents.join(", ") : "(none)";
	return `Capability ceiling from ${sources} does not allow agent '${agentName}'. Allowed agents: ${allowed}.`;
}

export function assertAgentAllowedByCapabilityCeiling(agentName: string, ceiling: ResolvedSubagentCapabilityCeiling | undefined): void {
	const message = capabilityCeilingAgentRestrictionMessage(agentName, ceiling);
	if (message) throw new Error(message);
}

export function capabilityCeilingAgentRestrictionSources(ceiling: ResolvedSubagentCapabilityCeiling | undefined): string[] | undefined {
	return ceiling?.allowedAgents === undefined ? undefined : [...ceiling.sources];
}
