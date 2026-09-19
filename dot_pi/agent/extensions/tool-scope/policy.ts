/**
 * tool-scope policy - which of this session's tools start inactive, and which
 * never appear at all. Pure: no pi API, no filesystem, no config file anywhere
 * in here.
 *
 * Two decisions, one shape:
 *   defer - the schema stays out of the prompt until load_tools activates it.
 *   off   - the tool is not part of the project's sessions at all.
 *
 * The defaults are the three levers measured on 2026-09-18 with
 * `node audits/harness-footprint.ts`: the subagent schema (4.1k tokens), the
 * four pi-web-access schemas (2.8k) and bg_wait (1.1k) - 7.9k of a 15.9k
 * per-session floor, spent on tools an ordinary session often never calls.
 */

/** Tools a session starts without, activatable on demand through load_tools. */
export const DEFAULT_DEFER = [
	'subagent',
	'web_search',
	'fetch_content',
	'source_check',
	'get_search_content',
	'bg_wait',
] as const

/** What each deferrable tool is for, so load_tools can say what it offers. */
const PURPOSES: Record<string, string> = {
	subagent: 'delegate work to subagents and workflows',
	web_search: 'search the web',
	fetch_content: 'fetch a page, repo or video',
	source_check: 'verify a claim against sources',
	get_search_content: 'read a previous search or fetch',
	bg_wait: 'wait on background work that cannot notify',
}

/** One config layer: the lists a global file or one project entry carries. */
export interface ScopeLists {
	defer?: string[]
	off?: string[]
}

/** A project's own lists, matched against the session cwd by prefix. */
export interface ProjectScope {
	prefix: string
	lists: ScopeLists
}

/** The parsed config. Absent lists fall back to the defaults, never to "none". */
export interface ToolScopeConfig extends ScopeLists {
	projects: ProjectScope[]
}

/** The resolved decision for one session. */
export interface ScopePlan {
	/** The active set the session should start with. */
	keep: string[]
	/** Active tools held back, activatable on demand. */
	deferred: string[]
	/** Active tools removed outright, not activatable. */
	disabled: string[]
}

/** What one load_tools call asked for, sorted into what it can do about it. */
export interface ActivationOutcome {
	activated: string[]
	disabled: string[]
	unknown: string[]
}

function readStrings(source: object, key: string): string[] | undefined {
	const rawList = Reflect.get(source, key)
	if (!Array.isArray(rawList)) return undefined
	const entries: unknown[] = rawList
	return entries.flatMap(entry => (typeof entry === 'string' ? [entry] : []))
}

function readObject(source: object, key: string): object | undefined {
	const rawObject = Reflect.get(source, key)
	if (typeof rawObject !== 'object' || rawObject === null) return undefined
	if (Array.isArray(rawObject)) return undefined
	return rawObject
}

/** Only the keys the file actually carries: absent and malformed both fall
 * back to the defaults, and an explicit empty list is what clears one. */
function readLists(source: object): ScopeLists {
	const lists: ScopeLists = {}
	const defer = readStrings(source, 'defer')
	const off = readStrings(source, 'off')
	if (defer) lists.defer = defer
	if (off) lists.off = off
	return lists
}

/** Every project entry, in file order; malformed entries are skipped. */
function readProjects(source: object): ProjectScope[] {
	const projects = readObject(source, 'projects')
	if (!projects) return []
	return Object.entries(projects).flatMap(([prefix, lists]) =>
		lists === null ? [] : [{ prefix, lists: readLists(lists) }],
	)
}

/** Parse a config file's contents; anything unreadable reads as empty. */
export function parseConfig(raw: unknown): ToolScopeConfig {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		return { projects: [] }
	}
	return { ...readLists(raw), projects: readProjects(raw) }
}

/** The defaults plus every project layer whose prefix matches this cwd. */
function listsFor(
	config: ToolScopeConfig,
	cwd: string,
): { defer: Set<string>; off: Set<string> } {
	const defer = new Set<string>(config.defer ?? DEFAULT_DEFER)
	const off = new Set<string>(config.off ?? [])
	for (const project of config.projects) {
		if (!cwd.startsWith(project.prefix)) continue
		for (const name of project.lists.defer ?? []) defer.add(name)
		for (const name of project.lists.off ?? []) off.add(name)
	}
	return { defer, off }
}

/** Resolve one session: what to keep, what to hold back, what to drop. */
export function resolvePlan(
	config: ToolScopeConfig,
	cwd: string,
	active: string[],
): ScopePlan {
	const { defer, off } = listsFor(config, cwd)
	const disabled = active.filter(name => off.has(name))
	const deferred = active.filter(name => defer.has(name) && !off.has(name))
	const removed = new Set([...disabled, ...deferred])
	return {
		keep: active.filter(name => !removed.has(name)),
		deferred,
		disabled,
	}
}

/** What load_tools offers, one name per tool plus what it is for. */
export function loaderDescription(deferred: string[]): string {
	const offered = deferred
		.map(name => (PURPOSES[name] ? `${name} (${PURPOSES[name]})` : name))
		.join(', ')
	return `Activate tools this session started without: ${offered}. Call with the names you need; they stay callable for the rest of the session.`
}

/** Sort requested names into activatable, disabled by config, and not ours. */
export function resolveActivation(
	requested: string[],
	deferred: string[],
	disabled: string[],
): ActivationOutcome {
	const deferredSet = new Set(deferred)
	const disabledSet = new Set(disabled)
	const outcome: ActivationOutcome = {
		activated: [],
		disabled: [],
		unknown: [],
	}
	for (const name of requested) {
		if (deferredSet.has(name)) outcome.activated.push(name)
		else if (disabledSet.has(name)) outcome.disabled.push(name)
		else outcome.unknown.push(name)
	}
	return outcome
}

/** The tool result a load_tools call returns. */
export function activationReport(
	outcome: ActivationOutcome,
	pending: string[],
): string {
	const lines: string[] = []
	if (outcome.activated.length > 0) {
		lines.push(`Activated: ${outcome.activated.join(', ')}.`)
	}
	if (outcome.disabled.length > 0) {
		lines.push(
			`Disabled in this project by tool-scope config: ${outcome.disabled.join(', ')}.`,
		)
	}
	if (outcome.unknown.length > 0) {
		lines.push(
			`Already available or not a tool: ${outcome.unknown.join(', ')}.`,
		)
	}
	if (pending.length > 0)
		lines.push(`Still held back: ${pending.join(', ')}.`)
	return lines.join(' ') || 'Nothing to activate.'
}
