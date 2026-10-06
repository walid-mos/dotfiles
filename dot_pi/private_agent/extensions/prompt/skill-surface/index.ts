/**
 * skill-surface - own what the session pays for in skills.
 *
 * The catalog pi puts in every request listed 59 skills (27.9 KB) regardless
 * of the project; the mandatory ones (coding, typescript, ...) cost a model
 * round trip to read, twice per session on average. This extension:
 *
 * 1. Filters the catalog in `before_agent_start`: skills hidden by config, or
 *    scoped to a project whose markers the cwd does not carry, leave the
 *    system prompt. They stay loadable by path and through `/skill:name`.
 * 2. Injects skill bodies through the `context` event, never as persisted
 *    messages: project autoloads from the first request, trigger autoloads
 *    from the first read/edit/write of a matching path. One `<skill>` block
 *    per skill, in pi's native format, placed right after the first prompt so
 *    the cached prefix stays stable.
 * 3. Refuses a `read` of an injected SKILL.md with a one-line reason.
 *
 * Modules:
 *   scope.ts - pure: config schema, project detection, visibility, triggers
 *
 * Config: `<agentDir>/skills.json` (schema in scope.ts), read once per session.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { getAgentDir } from '@earendil-works/pi-coding-agent'

import { isHumanPrompt } from '#lib/human-prompt.ts'
import { formatSkillBlock, readSkillBody } from '#lib/skills/block.ts'
import { runTimedHook } from '#lib/telemetry/hook-timing.ts'

import {
	PATH_TOOL_NAMES,
	parseSkillSurfaceConfig,
	planSurface,
	triggeredSkills,
} from './scope.ts'

import type {
	ContextEvent,
	ExtensionAPI,
	Skill,
} from '@earendil-works/pi-coding-agent'
import type { SkillSurfaceConfig, SurfacePlan } from './scope.ts'

const CONTEXT_TYPE = 'skill-surface'
const SKILL_TAG = /<skill name="([^"]+)"/g

function loadConfig(): SkillSurfaceConfig {
	const path = join(getAgentDir(), 'skills.json')
	if (!existsSync(path)) return {}
	return parseSkillSurfaceConfig(JSON.parse(readFileSync(path, 'utf8')))
}

const probes = {
	exists: (path: string): boolean => existsSync(path),
	readText: (path: string): string | undefined => {
		try {
			return readFileSync(path, 'utf8')
		} catch {
			return undefined
		}
	},
}

/** Everything one session remembers; a new session or reload starts over. */
class SkillSession {
	private universe = new Map<string, Skill>()
	private injected = new Map<string, string>()
	private pending = new Set<string>()
	private known = new Set<string>()
	private plan: SurfacePlan | undefined
	private message: ContextEvent['messages'][number] | undefined

	constructor(private readonly config: SkillSurfaceConfig) {}

	start(skills: readonly Skill[], cwd: string): SurfacePlan {
		this.universe = new Map(skills.map(skill => [skill.name, skill]))
		this.plan ??= planSurface(this.config, cwd, getAgentDir(), probes)
		for (const name of this.plan.autoload) this.request(name)
		return this.plan
	}

	/** A skill the prompt already expanded is loaded; never inject it twice. */
	markKnown(name: string): void {
		this.known.add(name)
	}

	request(name: string): void {
		if (this.known.has(name) || this.injected.has(name)) return
		this.pending.add(name)
	}

	trigger(toolName: string, path: string): void {
		for (const name of triggeredSkills(
			this.config,
			toolName,
			path,
			getAgentDir(),
		))
			this.request(name)
	}

	injectedSkillAt(path: string): string | undefined {
		for (const name of this.injected.keys()) {
			if (this.universe.get(name)?.filePath === path) return name
		}
		return undefined
	}

	/** The context message carrying every injected block, rebuilt only when the set grows. */
	contextMessage(): ContextEvent['messages'][number] | undefined {
		let hasGrown = false
		for (const name of this.pending) {
			const skill = this.universe.get(name)
			this.pending.delete(name)
			if (!skill) continue
			const body = readSkillBody(skill)
			if (body === null) continue
			this.injected.set(name, formatSkillBlock(skill, body))
			hasGrown = true
		}
		if (!this.injected.size) return undefined
		if (hasGrown || !this.message) {
			const names = [...this.injected.keys()].join(', ')
			this.message = {
				role: 'custom',
				customType: CONTEXT_TYPE,
				content: `Skills loaded for this session (their full content follows; never read their SKILL.md again): ${names}.\n\n${[...this.injected.values()].join('\n\n')}`,
				display: false,
				timestamp: Date.now(),
			}
		}
		return this.message
	}
}

function pathArgument(input: unknown): string | undefined {
	if (!input || typeof input !== 'object') return undefined
	const path = Reflect.get(input, 'path')
	if (typeof path !== 'string' || !path) return undefined
	return path
}

type Current = () => SkillSession

/** The catalog filter: visible skills only, decided once per session. */
function registerCatalog(pi: ExtensionAPI, current: Current): void {
	pi.on('before_agent_start', (event, ctx) =>
		runTimedHook('before_agent_start', 'skill-surface.catalog', () => {
			const skills = event.systemPromptOptions.skills ?? []
			const plan = current().start(skills, ctx.cwd)
			// oxlint-disable-next-line eslint/no-param-reassign - pi documents systemPromptOptions as mutable; later handlers observe the change
			event.systemPromptOptions.skills = skills.filter(skill =>
				plan.isVisible(skill.name),
			)
		}),
	)
}

/** Triggers from path-bearing tool calls, the reread refusal, and the injection itself. */
function registerAutoload(pi: ExtensionAPI, current: Current): void {
	pi.on('tool_call', (event, ctx) => {
		if (!PATH_TOOL_NAMES.has(event.toolName)) return undefined
		const path = pathArgument(event.input)
		if (!path) return undefined
		const absolute = resolve(ctx.cwd, path)
		const state = current()
		const loaded =
			event.toolName === 'read'
				? state.injectedSkillAt(absolute)
				: undefined
		if (loaded)
			return {
				block: true,
				reason: `Skill ${loaded} is already loaded in this session; its full content is in context.`,
			}
		state.trigger(event.toolName, absolute)
		return undefined
	})
	pi.on('context', event => {
		const message = current().contextMessage()
		if (!message) return undefined
		const messages = [...event.messages]
		const at = messages[0]?.role === 'user' ? 1 : 0
		messages.splice(at, 0, message)
		return { messages }
	})
}

export default function skillSurface(pi: ExtensionAPI): void {
	let session: SkillSession | undefined
	const current: Current = () => {
		session ??= new SkillSession(loadConfig())
		return session
	}
	const reset = (): void => {
		session = undefined
	}
	pi.on('session_start', reset)
	pi.on('session_shutdown', reset)
	pi.on('input', event => {
		if (!isHumanPrompt(event)) return
		for (const match of event.text.matchAll(SKILL_TAG)) {
			const [, name] = match
			if (name) current().markKnown(name)
		}
	})
	registerCatalog(pi, current)
	registerAutoload(pi, current)
}
