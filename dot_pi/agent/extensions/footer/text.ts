// Text and ANSI toolkit for the footer renderer: 24-bit color, OSC 8
// links, width measurement and truncation. Width handling lives here instead
// of @earendil-works/pi-tui values: that package only resolves through Pi's
// extension loader, and an import-free module keeps the pure renderer
// testable under plain node --test.
import { homedir } from 'node:os'

import { surfaceLineWidth } from '../ui/surface.ts'

import { LATTE, SEP_THIN } from './theme.ts'

/** OSC 8 clickable text (same argument order as pi-tui: text first). */
export function hyperlink(text: string, url: string): string {
	return `\u001b]8;;${url}\u0007${text}\u001b]8;;\u0007`
}

/** Quiet vertical separator between data groups. */
export function thinSep(): string {
	return fgHex(LATTE.surface1, SEP_THIN)
}

/** Muted metadata tier: labels, counters, resets. */
export function quietText(text: string): string {
	return fgHex(LATTE.subtext0, text)
}

export function visibleWidth(line: string): number {
	return surfaceLineWidth(line)
}

// sRGB byte radix and per-channel slice geometry of the #rrggbb form
const HEX_RADIX = 16
const CHANNEL_SPAN = 2
const HEX_CHANNEL_OFFSETS = { red: 1, green: 3, blue: 5 } as const
// LATTE.subtext0 channels, used when a hex color fails to rasterize
const FALLBACK_CHANNELS = { red: 108, green: 111, blue: 133 } as const

/** Rasterize a hex color into an sRGB triple. */
export function rgb(hex: string): [number, number, number] {
	const offsets = HEX_CHANNEL_OFFSETS
	const red = parseInt(
		hex.slice(offsets.red, offsets.red + CHANNEL_SPAN),
		HEX_RADIX,
	)
	const green = parseInt(
		hex.slice(offsets.green, offsets.green + CHANNEL_SPAN),
		HEX_RADIX,
	)
	const blue = parseInt(
		hex.slice(offsets.blue, offsets.blue + CHANNEL_SPAN),
		HEX_RADIX,
	)
	if (![red, green, blue].every(channel => Number.isFinite(channel))) {
		return [
			FALLBACK_CHANNELS.red,
			FALLBACK_CHANNELS.green,
			FALLBACK_CHANNELS.blue,
		]
	}
	return [red, green, blue]
}

/** Wrap `text` in a 24-bit truecolor foreground escape pair. */
export function fgHex(hex: string, text: string): string {
	const [red, green, blue] = rgb(hex)
	return `\x1b[38;2;${red};${green};${blue}m${text}\x1b[39m`
}

// ANSI escape sequences are the lexical domain of the footer toolchain
// oxlint-disable no-control-regex
const ANSI_TOKEN_PATTERN =
	/\u001b\[[0-?]*[ -/]*[@-~]|\u001b\]8;;[^\u0007]*\u0007|\u001b\]8;;\u0007|./gu
const OSC8_CLOSING_PATTERN = /^\u001b\]8;;\u0007$/
// oxlint-enable no-control-regex
const CSI_START = '\u001b['
const OSC8_OPEN_START = '\u001b]8;;'
const OSC8_CLOSE = '\u001b]8;;\u0007'

/** Hard-truncate an ANSI-styled line to `width` visible columns. */
export function truncateToWidth(line: string, width: number): string {
	if (visibleWidth(line) <= width) return line
	let seen = ''
	let used = 0
	let isInsideLink = false
	const tokens = line.match(ANSI_TOKEN_PATTERN) ?? []
	for (const token of tokens) {
		if (token.startsWith(CSI_START)) {
			seen += token
			continue
		}
		if (token.startsWith(OSC8_OPEN_START)) {
			// OSC 8 wrappers are zero-width; openers carry the URL, closers are bare
			isInsideLink = !OSC8_CLOSING_PATTERN.test(token)
			seen += token
			continue
		}
		const tokenWidth = surfaceLineWidth(token)
		if (used + tokenWidth > width) break
		used += tokenWidth
		seen += token
	}
	// Never leak an unclosed hyperlink when truncation lands inside one.
	return isInsideLink ? `${seen}${OSC8_CLOSE}` : seen
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
