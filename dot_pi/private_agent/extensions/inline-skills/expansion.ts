import { readFileSync } from 'node:fs'

import {
	getAgentDir,
	loadSkills,
	stripFrontmatter,
} from '@earendil-works/pi-coding-agent'

import { skillToken, SKILL_TOKEN_GLOBAL_RE } from './token.ts'

/**
 * Skill cache + multi-skill expansion for mid-prompt `/skill:` tokens.
 *
 * pi's native expansion (_expandSkillCommand) only handles a SINGLE `/skill:`
 * at the very start of the prompt: everything after the first space becomes
 * that skill's args. So `/skill:a /skill:b` loads `a` and passes `/skill:b`
 * through as literal args - `b` is never loaded, and `/skill:` mid-line is
 * never expanded at all.
 *
 * The `input` event (action: "transform") fires BEFORE the native expansion,
 * so we expand every token here, in the exact `<skill>` block format pi uses
 * natively. The native step then finds no `/skill:` prefix and passes the
 * already-expanded text through unchanged.
 *
 * Args: text after a skill name belongs to that skill, up to the next
 * `/skill:` token. `/skill:stack open a clean PR /skill:swarm` expands to
 * the stack block + "open a clean PR" + the swarm block.
 */
import type { ExtensionContext, Skill } from '@earendil-works/pi-coding-agent'

/**
 * Cache of known skills. Seeded by re-discovering default directories, then
 * replaced by pi's exact loaded list once before_agent_start fires.
 */
let skillsCache: { cwd: string; skills: Map<string, Skill> } | undefined

/** Drop the cache so the next lookup re-discovers (e.g. after /reload). */
export function resetSkillsCache(): void {
	skillsCache = undefined
}

/** Get the skill list, keyed by cwd so a new project re-discovers. */
export function getSkills(ctx: ExtensionContext): Map<string, Skill> {
	if (skillsCache && skillsCache.cwd === ctx.cwd) {
		return skillsCache.skills
	}
	const skillLoad = loadSkills({
		cwd: ctx.cwd,
		// pi's own agent dir: same source the runtime itself reads from
		agentDir: getAgentDir(),
		skillPaths: [],
		includeDefaults: true,
	})
	const skills = new Map(skillLoad.skills.map(skill => [skill.name, skill]))
	skillsCache = { cwd: ctx.cwd, skills }
	return skills
}

/** Replace the cache with pi's exact loaded skill list (covers npm packages). */
export function adoptLoadedSkills(
	loadedSkills: Skill[] | undefined,
	cwd: string,
): void {
	if (!Array.isArray(loadedSkills)) return
	skillsCache = {
		cwd,
		skills: new Map(loadedSkills.map(skill => [skill.name, skill])),
	}
}

/**
 * Expand every `/skill:name` token (at start or after whitespace) into its
 * `<skill>` content block, in the exact format pi uses natively. Unknown
 * skill names are left untouched (pi passes them through too). Surrounding
 * text - including the whitespace before each token - is preserved.
 */
export function expandAllSkills(
	text: string,
	skills: Map<string, Skill>,
): string {
	SKILL_TOKEN_GLOBAL_RE.lastIndex = 0
	const matches = [...text.matchAll(SKILL_TOKEN_GLOBAL_RE)].filter(m =>
		skills.has(m[1] ?? ''),
	)
	if (!matches.length) return text

	let expanded = ''
	let cursor = 0
	for (let i = 0; i < matches.length; i++) {
		const match = matches.at(i)
		if (!match) continue
		const [, skillName] = match
		if (!skillName) continue
		const skill = skills.get(skillName)
		const token = skillToken(skillName)
		const tokenStart = match.index + match[0].indexOf(token)
		const tokenEnd = tokenStart + token.length
		const next = matches.at(i + 1)
		const [, nextName] = next ?? []
		const nextTokenStart =
			next && nextName
				? next.index + next[0].indexOf(skillToken(nextName))
				: text.length

		expanded += text.slice(cursor, tokenStart)

		if (!skill) {
			// Unreadable / missing skill - leave the token untouched.
			expanded += token
			cursor = tokenEnd
			continue
		}

		const body = readSkillBody(skill)
		if (body === null) {
			// Unreadable skill file - leave the token untouched.
			expanded += token
			cursor = tokenEnd
			continue
		}

		expanded += formatSkillBlock(skill, body)

		const args = text.slice(tokenEnd, nextTokenStart).trim()
		if (args) {
			expanded += `\n\n${args}`
		}
		cursor = nextTokenStart
	}
	expanded += text.slice(cursor)
	return expanded
}

/** Skill body without frontmatter; null when the file is unreadable. */
function readSkillBody(skill: Skill): string | null {
	try {
		return stripFrontmatter(readFileSync(skill.filePath, 'utf-8')).trim()
	} catch {
		return null
	}
}

/** The exact `<skill>` block format pi's native expansion produces. */
function formatSkillBlock(skill: Skill, body: string): string {
	return (
		`<skill name="${skill.name}" location="${skill.filePath}">\n` +
		`References are relative to ${skill.baseDir}.\n\n${body}\n</skill>`
	)
}
