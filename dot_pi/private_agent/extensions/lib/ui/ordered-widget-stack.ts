import { subscribeSurfaceChanges, surfaceRegistry } from './surface.ts'

import type { ExtensionUIContext, Theme } from '@earendil-works/pi-coding-agent'
import type {
	TUI,
	TuiMouseEvent,
	TuiMouseEventResult,
} from '@earendil-works/pi-tui'
import type { SurfacePlacement } from './surface.ts'

const HOST_WIDGET_IDS: Record<SurfacePlacement, string> = {
	aboveEditor: 'ordered-above-editor',
	belowEditor: 'ordered-below-editor',
}

export const ABOVE_EDITOR_PRIORITY = {
	/** The review / PR context line sits above every other surface. */
	contextLine: 0,
	/** The pi version-drift warning sits under the context line, above everything else. */
	driftWarning: 10,
	/** The last /dump result stays above the prompt without entering the transcript. */
	dump: 50,
	usage: 60,
	/** Startup Jev failures must remain visible above the checklist. */
	goalWarning: 90,
	goal: 100,
	backgroundTasks: 200,
	activity: 300,
	attachments: 400,
} as const

export type OrderedWidgetEntry = {
	priority: number
	render: (width: number, theme: Theme) => string[]
	/** Consume a TUI mouse event landing inside the entry's rendered block; y is entry-local. */
	mouse?: (event: TuiMouseEvent, line: number) => boolean
}

type WidgetPlacement = SurfacePlacement

type PlacementBinding = {
	ui: ExtensionUIContext | null
	host: OrderedWidgetHost | null
}

// jiti gives every extension its own module registry, so these bindings live on
// globalThis: one host widget per placement for the whole process, whichever
// extension mounts it first (see surface.ts for the same reasoning).
const BINDINGS_KEY = Symbol.for('pi.ui.ordered-widget-bindings.v1')

function isBindingMap(
	candidate: unknown,
): candidate is Map<WidgetPlacement, PlacementBinding> {
	return candidate instanceof Map
}

const publishedBindings: unknown = Reflect.get(globalThis, BINDINGS_KEY)
const bindingsByPlacement: Map<WidgetPlacement, PlacementBinding> =
	isBindingMap(publishedBindings) ? publishedBindings : new Map()
Reflect.set(globalThis, BINDINGS_KEY, bindingsByPlacement)

class OrderedWidgetHost {
	private readonly unsubscribe: () => void

	private readonly tui: TUI
	private readonly readTheme: () => Theme
	private readonly placement: WidgetPlacement
	/** Segment map of the most recent render, for routing mouse events back to their entry. */
	private segments: {
		mouse: NonNullable<OrderedWidgetEntry['mouse']>
		start: number
		count: number
	}[] = []

	constructor(tui: TUI, readTheme: () => Theme, placement: WidgetPlacement) {
		this.tui = tui
		this.readTheme = readTheme
		this.placement = placement
		this.segments = []
		this.unsubscribe = subscribeSurfaceChanges(() =>
			this.tui.requestRender(),
		)
	}

	render(width: number): string[] {
		const segments = surfaceRegistry.renderSegments(
			this.placement,
			width,
			this.readTheme(),
		)
		this.segments = segments.flatMap(segment =>
			segment.entry.mouse
				? [
						{
							mouse: segment.entry.mouse,
							start: segment.start,
							count: segment.count,
						},
					]
				: [],
		)
		return segments.flatMap(segment => segment.lines)
	}

	/** Coordinates are host-local, matching the block map captured by the last render. */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const segment = this.segments.find(
			candidate =>
				event.y >= candidate.start &&
				event.y < candidate.start + candidate.count,
		)
		if (!segment?.mouse || !segment.mouse(event, event.y - segment.start))
			return undefined
		return { handled: true }
	}

	/** Called by pi-tui on theme changes and other global invalidations: re-render with live theme. */
	invalidate(): void {
		this.tui.requestRender()
	}

	dispose(): void {
		this.unsubscribe()
		const binding = bindingsByPlacement.get(this.placement)
		if (binding?.host === this) {
			binding.host = null
			binding.ui = null
		}
	}
}

export function setOrderedAboveEditorWidget(
	ui: ExtensionUIContext,
	key: string,
	entry: OrderedWidgetEntry | undefined,
): void {
	setOrderedSurfaceWidget(ui, key, entry, 'aboveEditor')
}

export function setOrderedSurfaceWidget(
	ui: ExtensionUIContext,
	key: string,
	entry: OrderedWidgetEntry | undefined,
	placement: WidgetPlacement = 'aboveEditor',
): void {
	if (!entry) {
		removeSurfaceEntry(ui, key, placement)
		return
	}
	surfaceRegistry.register({
		id: key,
		placement,
		priority: entry.priority,
		render: ({ width, theme }) => (theme ? entry.render(width, theme) : []),
		...(entry.mouse && { mouse: entry.mouse }),
	})
	mountHost(ui, placement)
}

function removeSurfaceEntry(
	ui: ExtensionUIContext,
	key: string,
	placement: WidgetPlacement,
): void {
	const removed = surfaceRegistry.unregister(key)
	if (!removed) return
	if (surfaceRegistry.hasEntries(placement)) return
	unmountHost(ui, placement)
}

/**
 * Mount the host widget for a placement once per process. A session rebind
 * (reload, session switch) disposes pi's component under a new ui context while
 * the binding survives on globalThis, so a binding held by a different ui is
 * stale and remounts under the caller's ui.
 */
function mountHost(ui: ExtensionUIContext, placement: WidgetPlacement): void {
	const binding = getBinding(placement)
	if (binding.host && binding.ui === ui) return
	binding.host?.dispose()
	binding.ui = ui
	ui.setWidget(
		HOST_WIDGET_IDS[placement],
		tui => {
			const host = new OrderedWidgetHost(tui, () => ui.theme, placement)
			binding.host = host
			return host
		},
		{ placement },
	)
}

function unmountHost(ui: ExtensionUIContext, placement: WidgetPlacement): void {
	bindingsByPlacement.get(placement)?.host?.dispose()
	ui.setWidget(HOST_WIDGET_IDS[placement], undefined)
}
function getBinding(placement: WidgetPlacement): PlacementBinding {
	const existing = bindingsByPlacement.get(placement)
	if (existing) return existing
	const binding: PlacementBinding = { ui: null, host: null }
	bindingsByPlacement.set(placement, binding)
	return binding
}
