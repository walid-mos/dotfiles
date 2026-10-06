/** The one `<skill>` block format pi's native expansion produces; inline-skills and skill-surface both emit it. */
import { readFileSync } from 'node:fs'

import { stripFrontmatter } from '@earendil-works/pi-coding-agent'

import type { Skill } from '@earendil-works/pi-coding-agent'

/** Skill body without frontmatter; null when the file is unreadable. */
export function readSkillBody(skill: Skill): string | null {
	try {
		return stripFrontmatter(readFileSync(skill.filePath, 'utf-8')).trim()
	} catch {
		return null
	}
}

export function formatSkillBlock(skill: Skill, body: string): string {
	return (
		`<skill name="${skill.name}" location="${skill.filePath}">\n` +
		`References are relative to ${skill.baseDir}.\n\n${body}\n</skill>`
	)
}
