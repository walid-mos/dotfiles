/** Pi 0.85.1 display adapter for every ToolExecutionComponent, including late/unknown tools.
 * Only the component's display definition changes. Registrations, schemas, execute and native
 * result/image conversion stay untouched. This is the sole owner of tool mouse geometry. */
import { Container } from '@earendil-works/pi-tui'

import { closeActivityRail } from '../ui/activity-line.ts'
import { patchPiComponent } from '../ui/pi-component-patch.ts'
import {
	invokePiMethod,
	reflectMember,
	renderPiComponent,
	typedHost,
} from '../ui/pi-members.ts'

import { readResponseMessage } from './response-message.ts'
import { toolMouseSurface } from './tool-mouse-surface.ts'
import { payloadText } from './tool-payload.ts'
import { ToolRow } from './tool-row.ts'

import type { Theme } from '@earendil-works/pi-coding-agent'
import type { ActivityClock } from '../ui/activity-clock.ts'
import type { RenderContext } from './tool-details.ts'

const NATIVE_DEFINITION = Symbol.for('pi.renderers.native-definition')

function nativeDefinition(definition: unknown): unknown {
	const object = typedHost(definition)
	return object && Reflect.has(object, NATIVE_DEFINITION)
		? Reflect.get(object, NATIVE_DEFINITION)
		: definition
}

function renderSurface(host: object, width: number): string[] {
	const lines = renderPiComponent(
		reflectMember(host, 'selfRenderContainer'),
		width,
	)
	Reflect.set(host, 'selfRenderHeight', lines.length)
	return lines
}

interface ToolLocation {
	parent: unknown
	siblings: readonly unknown[]
	roots: readonly unknown[]
	index: number
}

function componentChildren(component: unknown): readonly unknown[] {
	const children = reflectMember(component, 'children')
	return Array.isArray(children) ? children : []
}

function continuesToolChain(component: object): boolean {
	const message = reflectMember(component, 'lastMessage')
	if (reflectMember(message, 'role') !== 'assistant') return false
	const mode =
		reflectMember(component, 'isStreaming') === true
			? 'streaming'
			: 'settled'
	const response = readResponseMessage(message, mode)
	return (
		!response.notice &&
		!response.sections.some(section => section.kind === 'final')
	)
}

class ToolSurfaceRows {
	private readonly rows = new WeakMap<object, ToolRow>()
	private readonly locations = new WeakMap<object, ToolLocation>()
	private readonly displays = new Set<WeakRef<object>>()
	private readonly repaints = new WeakMap<object, () => void>()
	private readonly clock: ActivityClock

	constructor(clock: ActivityClock) {
		this.clock = clock
	}

	private repaintFor(host: object): () => void {
		const ui = typedHost(reflectMember(host, 'ui'))
		if (!ui) throw new Error('Pi tool row has no UI repaint target.')
		const repaint =
			this.repaints.get(ui) ??
			(() => {
				invokePiMethod(ui, 'requestRender')
			})
		this.repaints.set(ui, repaint)
		return repaint
	}

	rowFor(host: object): ToolRow {
		const cached = this.rows.get(host)
		if (cached) return cached
		const original = nativeDefinition(reflectMember(host, 'toolDefinition'))
		const row = new ToolRow(
			payloadText(host, 'toolName'),
			original,
			this.clock,
			this.repaintFor(host),
		)
		Reflect.set(host, 'toolDefinition', {
			[NATIVE_DEFINITION]: original,
			renderShell: 'self',
			renderCall: (args: unknown, theme: Theme, context: RenderContext) =>
				row.call(args, theme, context),
			renderResult: () => new Container(),
		})
		this.rows.set(host, row)
		this.displays.add(new WeakRef(host))
		return row
	}

	private locate(host: object): ToolLocation | undefined {
		const ui = reflectMember(host, 'ui')
		const roots = componentChildren(ui)
		const cached = this.locations.get(host)
		if (
			cached?.roots === roots &&
			componentChildren(cached.parent) === cached.siblings &&
			cached.siblings[cached.index] === host
		)
			return cached
		// Both regular and fullscreen Pi mount document -> chat in the public children tree.
		this.locations.delete(host)
		const parents = [ui, ...roots, ...roots.flatMap(componentChildren)]
		const parent = parents.find(candidate =>
			componentChildren(candidate).includes(host),
		)
		const siblings = componentChildren(parent)
		siblings.forEach((child, index) => {
			const component = typedHost(child)
			if (component && this.rows.has(component))
				this.locations.set(component, {
					parent,
					siblings,
					roots,
					index,
				})
		})
		return this.locations.get(host)
	}

	private hasFollowingTool(host: object): boolean {
		const location = this.locate(host)
		if (!location) return true // A standalone SDK component has no transcript grouping context.
		for (
			let index = location.index + 1;
			index < location.siblings.length;
			index++
		) {
			const sibling = typedHost(location.siblings[index])
			if (!sibling) return false
			const next = this.rows.get(sibling)
			if (next) return !next.isMutation()
			if (!continuesToolChain(sibling)) return false
		}
		return false
	}

	render(host: object, width: number): string[] {
		const row = this.rows.get(host)
		row?.updateImages(reflectMember(host, 'imageComponents'))
		const lines = renderSurface(host, width)
		if (
			row?.isMutation() ||
			lines.length > 1 ||
			reflectMember(host, 'expanded') === true ||
			this.hasFollowingTool(host)
		)
			return lines
		return lines.map((line, index) =>
			index === 0 ? closeActivityRail(line) : line,
		)
	}

	restore(): void {
		for (const reference of this.displays) {
			const host = reference.deref()
			if (host)
				Reflect.set(
					host,
					'toolDefinition',
					nativeDefinition(reflectMember(host, 'toolDefinition')),
				)
		}
		this.displays.clear()
	}
}

export function installToolSurface(
	component: unknown,
	clock: ActivityClock,
): () => void {
	const rows = new ToolSurfaceRows(clock)
	const restore = patchPiComponent(component, 'pi.renderers.tools', {
		hasRendererDefinition: () => true,
		getRenderShell: () => 'self',
		updateDisplay(host, original, args) {
			rows.rowFor(host).update(reflectMember(host, 'result'))
			return original(...args)
		},
		render: (host, _original, args) =>
			rows.render(host, typeof args[0] === 'number' ? args[0] : 0),
		handleMouse: (host, _original, args) =>
			toolMouseSurface(host, args[0], rows.rowFor(host)),
	})
	return () => {
		restore()
		rows.restore()
	}
}
