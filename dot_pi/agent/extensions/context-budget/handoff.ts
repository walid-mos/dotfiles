/**
 * context-budget - handoff files and the skill body injected with the nudge.
 *
 * The guard generates the handoff path itself, so the nudge the agent receives
 * and the compaction that consumes the file agree on one path without the model
 * choosing a name. The content rules stay in the registered `handoff` skill:
 * `resolveSkillBody` finds it through pi's command registry (never a hardcoded
 * path).
 */

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { skillBody } from './budget.ts'

import type { SlashCommandInfo } from '@earendil-works/pi-coding-agent'

/** Name of the skill that owns the handoff content rules. */
const HANDOFF_SKILL = 'handoff'
const SKILL_FILE = 'SKILL.md'

/** Session ids are uuids; eight characters are enough to name a file after one. */
const SESSION_PREFIX_LENGTH = 8
const TWO_DIGITS = 2
const STAMP_SEPARATOR = '-'

/** Zero-pad one stamp component. */
function padToTwo(digits: number): string {
	return `${digits}`.padStart(TWO_DIGITS, '0')
}

export function handoffDir(agentDir: string): string {
	return join(agentDir, 'handoffs')
}

/**
 * `<handoffs>/<session>-<YYYYMMDD-HHmmss>.md`, stamped in local time. Seconds
 * are part of the name because a session can reach the ceiling more than once:
 * two cycles in the same minute must not share a path, or an ignored second
 * request would leave the first handoff in place and be consumed as if it were
 * current.
 */
export function handoffPath(
	agentDir: string,
	sessionId: string,
	at: Date,
): string {
	const stamp = [
		at.getFullYear(),
		padToTwo(at.getMonth() + 1),
		padToTwo(at.getDate()),
		STAMP_SEPARATOR,
		padToTwo(at.getHours()),
		padToTwo(at.getMinutes()),
		padToTwo(at.getSeconds()),
	].join('')
	const prefix = sessionId.slice(0, SESSION_PREFIX_LENGTH)
	return join(handoffDir(agentDir), `${prefix}-${stamp}.md`)
}

/**
 * Body of the registered `handoff` skill, or undefined when it is not
 * installed. Matches on the command name suffix so a namespaced registration
 * (`skill:handoff`) resolves too.
 */
export function resolveSkillBody(
	commands: SlashCommandInfo[],
): string | undefined {
	const skill = commands.find(
		command =>
			command.source === 'skill' &&
			(command.name === HANDOFF_SKILL ||
				command.name.endsWith(`:${HANDOFF_SKILL}`)),
	)
	if (!skill) return undefined
	const path = skill.sourceInfo.path.endsWith('.md')
		? skill.sourceInfo.path
		: join(skill.sourceInfo.path, SKILL_FILE)
	try {
		return skillBody(readFileSync(path, 'utf8'))
	} catch {
		return undefined
	}
}

/** Whether a handoff file exists and holds actual content. */
export function isUsableHandoff(path: string): boolean {
	try {
		const stats = statSync(path)
		return stats.isFile() && stats.size > 0
	} catch {
		return false
	}
}
