import { CustomEditor } from '@earendil-works/pi-coding-agent'

/** Compose editor decorators from several extensions exactly once per session. */
import type {
	ExtensionAPI,
	KeybindingsManager,
} from '@earendil-works/pi-coding-agent'
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

/**
 * The base editor every decorator chains onto: pi's `CustomEditor` with the
 * working status embedded in the prompt's top border.
 *
 * A custom editor keeps the standalone working row unless it opts in, which
 * prints the loader on its own line above the prompt with a blank line under
 * it. Every `registerEditorDecorator` caller must pass this factory: only the
 * first registered decorator builds the base, and extensions load in
 * filesystem order.
 */
export function createDefaultEditor(
	tui: TUI,
	theme: EditorTheme,
	keybindings: KeybindingsManager,
): CustomEditor {
	return new CustomEditor(tui, theme, keybindings, {
		embedWorkingStatus: true,
	})
}

/**
 * Columns the embedded working loader can occupy in the prompt's top border:
 * pi's `── ` prefix, the spinner, the message and the space before the dashes
 * resume. The house word list's longest message is 19 columns.
 *
 * Anything else drawn in that border must reserve this field, so a rotating
 * message can neither overlay it nor move it (see `prompt-telemetry`).
 */
export const EMBEDDED_LOADER_FIELD_WIDTH = 25

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
