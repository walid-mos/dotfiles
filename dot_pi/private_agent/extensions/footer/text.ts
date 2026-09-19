/** Footer-specific labels, paths and counters. Terminal mechanics live in ui/. */
import { homedir } from 'node:os'

import { PI_PALETTE as LATTE } from '../ui/design-system/palette.ts'
import { foregroundHex as fgHex } from '../ui/design-system/terminal-color.ts'

import { SEP_THIN } from './theme.ts'

export function thinSep(): string {
	return fgHex(LATTE.surface1, SEP_THIN)
}

export function quietText(text: string): string {
	return fgHex(LATTE.subtext0, text)
}

/** Default longest visible path before the footer compresses it. */
export const PATH_COMPACT_MAX_CHARS = 34
const PATH_OVERFLOW_MARK = '\u2026'
const PATH_HEAD_CHARS = 2
// A runaway tail keeps the last two components (~/…/ui/extensions)
const PATH_TAIL_COMPONENTS = -2

/** Compress a shortened path to its head and last two components: ~/…/ui/extensions */
export function compactPath(
	path: string,
	maxWidth: number = PATH_COMPACT_MAX_CHARS,
): string {
	if (path.length <= maxWidth) return path
	const parts = path.split('/').filter(Boolean)
	if (parts.length <= PATH_HEAD_CHARS) return path
	const head = path.startsWith('~') ? '~/' : '/'
	const tail = parts.slice(PATH_TAIL_COMPONENTS).join('/')
	const compressed = `${head}${PATH_OVERFLOW_MARK}/${tail}`
	return compressed.length < path.length ? compressed : path
}

const MAX_LENGTH_MARGIN = 1

/** Flat link wrapper: quiet brackets hugging the tinted content. */
export function bracketed(content: string): string {
	return `${fgHex(LATTE.surface1, '[')}${content}${fgHex(LATTE.surface1, ']')}`
}

/** Hard-clamp plain text with a trailing ellipsis. */
export function clampText(text: string, maxLength: number): string {
	return text.length <= maxLength
		? text
		: `${text.slice(0, Math.max(MAX_LENGTH_MARGIN, maxLength - MAX_LENGTH_MARGIN))}${PATH_OVERFLOW_MARK}`
}

const TOKEN_KILO = 1000
const TOKEN_MILLION = 1_000_000
const TOKEN_KILO_DECIMALS = 1
const TOKEN_MILLION_DECIMALS = 2

/** 1234 → "1.2k", 1234567 → "1.23M". */
export function fmtTokens(count: number): string {
	if (count < TOKEN_KILO) return `${count}`
	if (count < TOKEN_MILLION) {
		return `${(count / TOKEN_KILO).toFixed(TOKEN_KILO_DECIMALS)}k`
	}
	return `${(count / TOKEN_MILLION).toFixed(TOKEN_MILLION_DECIMALS)}M`
}

const HOME_MARK = '~'

/** Absolute cwd → home-relative form when possible: /Users/x/... → ~/... */
export function shortPath(cwd: string): string {
	const home = homedir()
	if (cwd === home) return HOME_MARK
	if (cwd.startsWith(`${home}/`)) {
		return `${HOME_MARK}/${cwd.slice(home.length + 1)}`
	}
	return cwd
}
