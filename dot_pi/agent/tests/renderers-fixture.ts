/** Real Pi components without terminal IO. Only the clock and terminal boundary are controlled. */
import { stripVTControlCharacters } from 'node:util'

import {
	createBashToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createReadToolDefinition,
	ToolExecutionComponent,
} from '@earendil-works/pi-coding-agent'
import {
	Container,
	ProcessTerminal,
	TuiMainScreen,
} from '@earendil-works/pi-tui'

import { ActivityClock } from '../extensions/ui/activity-clock.ts'
import { loadPiRuntime } from '../extensions/ui/pi-runtime.ts'
import { initTheme } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js'

import type { Component, TuiMouseEvent } from '@earendil-works/pi-tui'
import type { ToolRenderers } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js'

initTheme('dark')
export const runtime = await loadPiRuntime('')

class QuietTerminal extends ProcessTerminal {
	override write(): void {
		/* Test terminal never writes to stdout. */
	}
	override hideCursor(): void {
		/* No terminal IO. */
	}
	override showCursor(): void {
		/* No terminal IO. */
	}
}

const ui = new TuiMainScreen(new QuietTerminal())
type RendererDefinition = ToolRenderers
const definitions = new Map<string, () => RendererDefinition>([
	['read', () => createReadToolDefinition('/tmp')],
	['bash', () => createBashToolDefinition('/tmp')],
	['grep', () => createGrepToolDefinition('/tmp')],
	['find', () => createFindToolDefinition('/tmp')],
])

export function toolRow(
	name: string,
	args: unknown = {},
	definition?: RendererDefinition,
): ToolExecutionComponent {
	return new ToolExecutionComponent(
		name,
		`${name}-test`,
		args,
		{},
		definition ?? definitions.get(name)?.(),
		ui,
		'/tmp',
	)
}

export function toolTranscript(children: readonly Component[]): Container {
	const transcript = new Container()
	for (const child of children) transcript.addChild(child)
	const document = new Container()
	document.addChild(transcript)
	ui.clear()
	ui.addChild(document)
	return transcript
}

export function complete(row: ToolExecutionComponent, text = 'one\ntwo'): void {
	row.setArgsComplete()
	row.updateResult({ content: [{ type: 'text', text }], isError: false })
}

export function visible(lines: string[]): string[] {
	return lines.map(line => stripVTControlCharacters(line).trimEnd())
}

export function click(y = 0): TuiMouseEvent {
	return {
		type: 'click',
		button: 'left',
		x: 5,
		y,
		screenX: 5,
		screenY: y,
		width: 80,
		height: 20,
		shift: false,
		alt: false,
		ctrl: false,
	}
}

export class ManualActivityTime {
	milliseconds = 0
	private tick: () => void = () => {}
	isScheduled = false
	readonly clock = new ActivityClock(
		() => this.milliseconds,
		tick => {
			this.tick = tick
			this.isScheduled = true
			return () => {
				this.isScheduled = false
			}
		},
	)

	advance(milliseconds: number): void {
		this.milliseconds += milliseconds
		if (this.isScheduled) this.tick()
	}
}
