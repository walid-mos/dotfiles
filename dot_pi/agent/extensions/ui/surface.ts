import type { Theme } from '@earendil-works/pi-coding-agent'

export type SurfacePlacement = 'aboveEditor' | 'belowEditor'

export type SurfaceRenderContext = {
	width: number
	theme: Theme | undefined
}

export type SurfaceEntry = {
	id: string
	placement: SurfacePlacement
	priority?: number
	/** Maximum rendered lines kept for this entry; extra lines collapse into a truncation marker. */
	maxLines?: number
	render: (context: SurfaceRenderContext) => readonly string[]
}

// Widget surface library shared across extensions - intentionally NOT an
// extension itself (pi discovers extensions/<dir>/index.ts; this folder has no
// index on purpose). Extensions opt in by importing from here.
//
// surface.ts is the placement registry (above/below editor); ordered-widget
// stack is the mounting adapter that binds registered entries to pi widgets.

export const DEFAULT_MAX_SURFACE_LINES = 10

export type SurfaceRegistry = {
	register: (entry: SurfaceEntry) => () => void
	unregister: (id: string) => boolean
	clear: () => void
	hasEntries: (placement?: SurfacePlacement) => boolean
	render: (
		placement: SurfacePlacement,
		width: number,
		theme?: Theme,
	) => string[]
	subscribe: (listener: () => void) => () => void
}

type RegistryState = {
	entries: Map<string, SurfaceEntry>
	listeners: Set<() => void>
}

function notifyListeners(listeners: RegistryState['listeners']): void {
	for (const listener of listeners) listener()
}

function registerEntry(state: RegistryState, entry: SurfaceEntry): () => void {
	state.entries.set(entry.id, entry)
	notifyListeners(state.listeners)
	let isSubscribed = true
	return () => {
		if (!isSubscribed) return
		isSubscribed = false
		if (state.entries.get(entry.id) !== entry) return
		state.entries.delete(entry.id)
		notifyListeners(state.listeners)
	}
}

function unregisterEntry(state: RegistryState, id: string): boolean {
	if (!state.entries.has(id)) return false
	state.entries.delete(id)
	notifyListeners(state.listeners)
	return true
}

function clearEntries(state: RegistryState): void {
	if (state.entries.size === 0) return
	state.entries.clear()
	notifyListeners(state.listeners)
}

function hasPlacementEntries(
	state: RegistryState,
	placement?: SurfacePlacement,
): boolean {
	return [...state.entries.values()].some(
		entry => !placement || entry.placement === placement,
	)
}

function renderPlacement(
	state: RegistryState,
	placement: SurfacePlacement,
	safeWidth: number,
	theme: Theme | undefined,
): string[] {
	if (safeWidth === 0) return []
	return [...state.entries.values()]
		.filter(entry => entry.placement === placement)
		.toSorted(compareSurfaceEntries)
		.flatMap(entry => renderSurfaceEntry(entry, safeWidth, theme))
}

export function createSurfaceRegistry(): SurfaceRegistry {
	const state: RegistryState = { entries: new Map(), listeners: new Set() }
	return {
		register: (entry: SurfaceEntry) => registerEntry(state, entry),
		unregister: (id: string) => unregisterEntry(state, id),
		clear: () => clearEntries(state),
		hasEntries: (placement?: SurfacePlacement) =>
			hasPlacementEntries(state, placement),
		render: (placement: SurfacePlacement, width: number, theme?: Theme) => {
			const safeWidth = Number.isFinite(width)
				? Math.max(0, Math.floor(width))
				: 0
			return renderPlacement(state, placement, safeWidth, theme)
		},
		subscribe: (listener: () => void) => {
			state.listeners.add(listener)
			return () => state.listeners.delete(listener)
		},
	}
}

export const surfaceRegistry = createSurfaceRegistry()

export function subscribeSurfaceChanges(listener: () => void): () => void {
	return surfaceRegistry.subscribe(listener)
}

function renderSurfaceEntry(
	entry: SurfaceEntry,
	width: number,
	theme: Theme | undefined,
): string[] {
	let lines: readonly string[]
	try {
		lines = entry.render({ width, theme })
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error)
		return [`[surface] ${entry.id}: render failed (${message})`].map(line =>
			clipSurfaceLine(line, width),
		)
	}
	const maxLines = entry.maxLines ?? DEFAULT_MAX_SURFACE_LINES
	const visible = lines
		.slice(0, maxLines)
		.map(line => clipSurfaceLine(line, width))
	if (lines.length <= maxLines) return visible
	return [...visible, `… (+${String(lines.length - maxLines)} lines)`]
}

function compareSurfaceEntries(
	left: SurfaceEntry,
	right: SurfaceEntry,
): number {
	const priority = (left.priority ?? 0) - (right.priority ?? 0)
	return priority === 0 ? left.id.localeCompare(right.id) : priority
}

/** Visible column width of a line, ignoring ANSI escape sequences. */
export function surfaceLineWidth(line: string): number {
	const tokens = line.match(SURFACE_TOKEN_PATTERN) ?? []
	return tokens.reduce(
		(total, token) =>
			isAnsiSequence(token) ? total : total + terminalCharWidth(token),
		0,
	)
}

function clipSurfaceLine(line: string, width: number): string {
	const firstLine = line.split(/[\r\n]/u, 1)[0] ?? ''
	const tokens = firstLine.match(SURFACE_TOKEN_PATTERN) ?? []
	if (surfaceLineWidth(firstLine) <= width) return firstLine
	const budget = Math.max(0, width - 1)
	let used = 0
	let clipped = ''
	let hasAnsi = false
	for (const token of tokens) {
		if (isAnsiSequence(token)) {
			hasAnsi = true
			clipped += token
			continue
		}
		const tokenWidth = terminalCharWidth(token)
		if (used + tokenWidth > budget) break
		used += tokenWidth
		clipped += token
	}
	clipped += '…'
	return hasAnsi ? `${clipped}\u001b[0m` : clipped
}

// ANSI escape sequences inherently use control characters (ESC is 0x1b):
// detecting them is the lexical domain of this renderer.
// oxlint-disable no-control-regex
const SURFACE_TOKEN_PATTERN =
	/\u001b\[[0-?]*[ -/]*[@-~]|\u001b\]8;;[^\u0007]*\u0007|\u001b\]8;;\u0007|./gu
const ANSI_SEQUENCE_PATTERN = /^\u001b(\[|\]8;;)/u
// oxlint-enable no-control-regex

function isAnsiSequence(token: string): boolean {
	// Both CSI (\e[…) and OSC 8 hyperlink wrappers (\e]8;;…) are zero-width.
	return ANSI_SEQUENCE_PATTERN.test(token)
}

// East Asian Wide/Fullwidth ranges plus common emoji. Inclusive bounds;
// code points in these ranges render two terminal cells instead of one.
const WIDE_CODEPOINT_RANGES = {
	hangulJamo: { start: 0x1100, end: 0x115f },
	cjkBrackets: { start: 0x2329, end: 0x232a },
	cjkThroughHangul: { start: 0x2e80, end: 0xa4cf },
	hangulSyllables: { start: 0xac00, end: 0xd7a3 },
	cjkCompatibility: { start: 0xf900, end: 0xfaff },
	verticalForms: { start: 0xfe10, end: 0xfe6f },
	fullwidthAscii: { start: 0xff00, end: 0xff60 },
	fullwidthSymbols: { start: 0xffe0, end: 0xffe6 },
	emojiPictographs: { start: 0x1f300, end: 0x1faff },
} as const

const WIDE_RANGE_LIST = Object.values(WIDE_CODEPOINT_RANGES)

// A wide code point occupies two terminal cells, everything else one
const WIDE_CELLS = 2
const NARROW_CELLS = 1

function terminalCharWidth(token: string): number {
	const codePoint = token.codePointAt(0) ?? 0
	const isWide = WIDE_RANGE_LIST.some(
		range => codePoint >= range.start && codePoint <= range.end,
	)
	return isWide ? WIDE_CELLS : NARROW_CELLS
}
