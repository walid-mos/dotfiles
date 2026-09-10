import type {
	ExtensionAPI,
	KeybindingsManager,
} from '@earendil-works/pi-coding-agent'
/** Compose editor decorators from several extensions exactly once per session. */
import type { EditorComponent, EditorTheme, TUI } from '@earendil-works/pi-tui'

/** Same shape pi's `ui.setEditorComponent` accepts. */
export type EditorFactory = (
	tui: TUI,
	theme: EditorTheme,
	keybindings: KeybindingsManager,
) => EditorComponent

/**
 * Wrap the editor pi currently uses; may rebind instance methods or callbacks.
 * The live TUI comes along so a decorator rendering dynamic content can request
 * its own repaints, instead of reaching for protected editor internals.
 */
export type EditorDecorator = (
	base: EditorComponent,
	keybindings: KeybindingsManager,
	tui: TUI,
) => EditorComponent

const decoratorsByFactory = new WeakMap<
	EditorFactory,
	ReadonlySet<EditorDecorator>
>()

/**
 * Compose one decorator exactly once across every session_start event. The
 * applied-decorator set follows the complete factory chain, so independently
 * registered decorators never wrap each other again when pi re-runs
 * session_start (new session, reload): the current factory is reused and
 * only receives decorators not applied to it yet.
 */
export function registerEditorDecorator(
	pi: ExtensionAPI,
	createDefault: EditorFactory,
	decorate: EditorDecorator,
): void {
	pi.on('session_start', (_event, context) => {
		const previous = context.ui.getEditorComponent()
		if (previous && decoratorsByFactory.get(previous)?.has(decorate)) return

		const factory: EditorFactory = (tui, theme, keybindings) => {
			const base =
				previous?.(tui, theme, keybindings) ??
				createDefault(tui, theme, keybindings)
			return decorate(base, keybindings, tui)
		}
		const applied = new Set(
			previous ? decoratorsByFactory.get(previous) : undefined,
		)
		applied.add(decorate)
		decoratorsByFactory.set(factory, applied)
		context.ui.setEditorComponent(factory)
	})
}
