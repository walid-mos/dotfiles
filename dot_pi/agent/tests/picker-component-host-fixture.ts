/**
 * The fake screen the picker tests mount against.
 *
 * `ctx.ui.custom` replaces the editor with a component that pi drives with raw
 * terminal bytes; this host does the same, and keeps the mounted component
 * reachable only while it is open, so a test can send keys, clicks or a wheel
 * event and render the frame at any terminal size.
 */

import type { Recorder } from './picker-harness-fixture.ts'

export const DEFAULT_WIDTH = 100
export const DEFAULT_HEIGHT = 40

interface PickerComponent {
	handleInput(data: string): void
	handleMouse?(event: unknown): unknown
	render(width: number): string[]
}

/** The pi types carry dozens of members; a double implements the few in use. */
export function double<T>(candidate: unknown): T {
	// oxlint-disable-next-line nextnode/no-type-assertion
	return candidate as T
}

export interface MouseInput {
	type: string
	button?: string
	lineIndex: number
	wheelDelta?: number
}

export interface ComponentHost {
	ui: unknown
	/** True while the picker owns the editor. */
	isOpen: () => boolean
	press: (key: string) => void
	/** A mouse event on the line the frame rendered at `lineIndex`. */
	mouse: (event: MouseInput) => void
	render: (width: number, height?: number) => string[]
}

/** The screen keeps the height that render was asked for. */
function renderAt(
	component: PickerComponent,
	screen: { columns: number; rows: number },
	width: number,
	height: number,
): string[] {
	Object.assign(screen, { columns: screen.columns, rows: height })
	return component.render(width)
}

function mouseEvent(input: MouseInput): unknown {
	return double({
		type: input.type,
		button: input.button ?? 'left',
		x: 0,
		y: input.lineIndex,
		screenX: 0,
		screenY: input.lineIndex,
		width: DEFAULT_WIDTH,
		height: DEFAULT_HEIGHT,
		shift: false,
		alt: false,
		ctrl: false,
		wheelDelta: input.wheelDelta,
	})
}

/** The `ctx.ui` surface the picker opens its component on. */
function createHostUi(
	recorder: Recorder,
	mount: (factory: unknown, resolve: (outcome: unknown) => void) => void,
): unknown {
	return {
		custom: (factory: unknown) => {
			recorder.modalsOpened.push('custom')
			return new Promise(resolve => mount(factory, resolve))
		},
		select: () => {
			recorder.modalsOpened.push('select')
			throw new Error('the picker must not open a built-in select dialog')
		},
		notify: (message: string) => recorder.notices.push(message),
		setStatus: () => undefined,
	}
}

export function createComponentHost(recorder: Recorder): ComponentHost {
	const screen = { columns: DEFAULT_WIDTH, rows: DEFAULT_HEIGHT }
	let component: PickerComponent | undefined
	const mount = (
		factory: unknown,
		resolve: (outcome: unknown) => void,
	): void => {
		const build =
			double<
				(
					tui: unknown,
					theme: unknown,
					keybindings: unknown,
					done: (outcome: unknown) => void,
				) => PickerComponent
			>(factory)
		component = build(
			{ requestRender: () => undefined, terminal: screen },
			{
				fg: (_role: string, text: string) => text,
				bold: (t: string) => t,
			},
			{},
			outcome => {
				component = undefined
				resolve(outcome)
			},
		)
	}
	const opened = (): PickerComponent => {
		if (!component) throw new Error('expected an open picker')
		return component
	}
	return {
		ui: createHostUi(recorder, mount),
		isOpen: () => Boolean(component),
		press: key => opened().handleInput(key),
		mouse: input => opened().handleMouse?.(mouseEvent(input)),
		render: (width, height = DEFAULT_HEIGHT) =>
			renderAt(opened(), screen, width, height),
	}
}
