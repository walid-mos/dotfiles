import { columnWidth, truncateTerminalLine } from './terminal-text.ts'

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
			const safeWidth = columnWidth(width)
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
	return [
		...visible,
		clipSurfaceLine(`… (+${String(lines.length - maxLines)} lines)`, width),
	]
}

function compareSurfaceEntries(
	left: SurfaceEntry,
	right: SurfaceEntry,
): number {
	const priority = (left.priority ?? 0) - (right.priority ?? 0)
	return priority === 0 ? left.id.localeCompare(right.id) : priority
}

function clipSurfaceLine(line: string, width: number): string {
	const firstLine = line.split(/[\r\n]/u, 1)[0] ?? ''
	return truncateTerminalLine(firstLine, width, '…')
}
