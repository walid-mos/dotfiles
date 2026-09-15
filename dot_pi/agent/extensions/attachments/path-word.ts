/** Shell-word decoding and explicit local-path boundaries for prompt scanning. */
import { IMAGE_ALIAS_PATTERN, looksLikePath } from './image-paths.ts'

/** Aliases are tokens, even when a paste starts immediately after one. */
const SHELL_WORD = /"(?:\\.|[^"\\])*"|'[^']*'|(?:\\.|[^\s])+/gu
export const PROMPT_WORD_PATTERN = new RegExp(
	`${IMAGE_ALIAS_PATTERN.source}|${SHELL_WORD.source}`,
	'gu',
)
const WHOLE_IMAGE_ALIAS = new RegExp(`^${IMAGE_ALIAS_PATTERN.source}$`, 'u')

/** Merges must not cross aliases or consume shell quoting as raw path bytes. */
export function isMergeableWord(match: RegExpMatchArray): boolean {
	const [word = ''] = match
	if (!word || WHOLE_IMAGE_ALIAS.test(word)) return false
	const [first] = word
	return first !== '"' && first !== "'" && decodeShellWord(word) === word
}

/** Strip one level of shell quoting and backslash escaping. */
export function decodeShellWord(token: string): string {
	if (token.startsWith("'") && token.endsWith("'")) return token.slice(1, -1)
	if (token.startsWith('"') && token.endsWith('"')) return token.slice(1, -1)
	return token.replace(/\\(.)/gu, '$1')
}

/** Only a leading local path (optionally bracketed) may read from disk. */
export function pathStartIndexes(pathText: string): number[] {
	const prefix = /^[([{`"']*/u.exec(pathText)?.[0] ?? ''
	const start = prefix.length
	return looksLikePath(pathText.slice(start)) ? [start] : []
}

/** Longest candidate first, then successive trailing punctuation trims. */
export function pathEndIndexes(pathText: string, start: number): number[] {
	const indexes = [pathText.length]
	let end = pathText.length
	while (end > start && /[,.;:!?\])}]/u.test(pathText[end - 1] ?? '')) {
		end -= 1
		indexes.push(end)
	}
	return indexes
}
