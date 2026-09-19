/** Expanded content boundary. Native slots keep their shared state and their own component caches. */
import { stripVTControlCharacters } from 'node:util'

import { Container, isFocusable, Text } from '@earendil-works/pi-tui'

import { ActivityDetails } from '../ui/activity-details.ts'
import { uiTheme } from '../ui/design-system/theme.ts'
import { reflectMember, renderPiComponent } from '../ui/pi-members.ts'

import { payloadText } from './tool-payload.ts'

import type { Theme, ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'
import type { ToolOutput } from './tool-payload.ts'

export type RenderContext =
	Parameters<NonNullable<ToolDefinition['renderCall']>> extends [
		unknown,
		unknown,
		infer Context,
	]
		? Context
		: never

interface DetailRequest {
	mode: 'text' | 'native'
	output: ToolOutput | undefined
	toolResult: unknown
	theme: Theme
	context: RenderContext
	layout?: 'plain' | 'rail'
}

const JSON_INDENT = 2

function isComponent(component: unknown): component is Component {
	return (
		typeof reflectMember(component, 'render') === 'function' &&
		typeof reflectMember(component, 'invalidate') === 'function'
	)
}

function plainDetails(
	args: unknown,
	output: ToolOutput | undefined,
): Component {
	const argumentsText =
		payloadText(args, 'command') ||
		JSON.stringify(args, null, JSON_INDENT) ||
		''
	const images = output?.imageCount
		? `[${String(output.imageCount)} image attachment(s)]`
		: ''
	const fullOutput = payloadText(output?.details, 'fullOutputPath')
	const source = [
		argumentsText,
		output?.text,
		images,
		fullOutput ? `Full output: ${fullOutput}` : '',
	]
		.filter(Boolean)
		.join('\n')
	return new Text(
		uiTheme.fg('output', stripVTControlCharacters(source)),
		0,
		0,
	)
}

/** Validate each slot before Container can normalize an invalid iterable into lines. */
function checkedNativeSlot(content: Component): Component {
	const slot: Component = {
		render: width => renderPiComponent(content, width),
		invalidate: () => content.invalidate(),
		handleMouse: event => content.handleMouse?.(event),
		handleInput: input => content.handleInput?.(input),
		get wantsKeyRelease() {
			return content.wantsKeyRelease ?? false
		},
	}
	if (isFocusable(content))
		Object.defineProperty(slot, 'focused', {
			get: () => content.focused,
			set: (focus: unknown) => {
				if (typeof focus === 'boolean')
					Reflect.set(content, 'focused', focus)
			},
		})
	return slot
}

function guardedDetails(content: Component, fallback: Component): Component {
	return {
		render(width) {
			try {
				return renderPiComponent(content, width)
			} catch {
				return fallback.render(width)
			}
		},
		invalidate: () => content.invalidate(),
		handleMouse: event => content.handleMouse?.(event),
	}
}

function layoutDetails(
	content: Component,
	layout: DetailRequest['layout'],
): Component {
	return layout === 'plain' ? content : new ActivityDetails(content)
}

export class ToolDetails {
	private callComponent?: Component
	private resultComponent?: Component
	private hasNativeContent = false
	private readonly nativeDefinition: unknown

	constructor(nativeDefinition: unknown) {
		this.nativeDefinition = nativeDefinition
	}

	build(request: DetailRequest): Component {
		const { mode, output, context } = request
		if (!context.expanded && !this.hasNativeContent) return new Container()
		const fallback = plainDetails(context.args, output)
		if (mode === 'text') return layoutDetails(fallback, request.layout)
		try {
			const content = this.nativeContent(request, fallback)
			this.hasNativeContent = true
			// Once mounted, native slots continue receiving completion to retire their own resources.
			return context.expanded
				? layoutDetails(
						guardedDetails(content, fallback),
						request.layout,
					)
				: new Container()
		} catch {
			return context.expanded
				? layoutDetails(fallback, request.layout)
				: new Container()
		}
	}

	private nativeContent(
		request: DetailRequest,
		fallback: Component,
	): Component {
		const { toolResult, theme, context } = request
		const content = new Container()
		const renderCall = reflectMember(this.nativeDefinition, 'renderCall')
		const renderResult = reflectMember(
			this.nativeDefinition,
			'renderResult',
		)
		if (
			typeof renderCall !== 'function' &&
			typeof renderResult !== 'function'
		)
			return fallback
		if (typeof renderCall === 'function') {
			const call: unknown = renderCall(context.args, theme, {
				...context,
				lastComponent: this.callComponent,
			})
			if (!isComponent(call))
				throw new Error('Native call renderer returned no component.')
			this.callComponent = call
			content.addChild(checkedNativeSlot(call))
		}
		if (toolResult && typeof renderResult !== 'function')
			content.addChild(fallback)
		if (toolResult && typeof renderResult === 'function') {
			// Match Pi's fresh presentation envelope; reassignment must not alter the stored message.
			const body: unknown = renderResult(
				{
					content: reflectMember(toolResult, 'content'),
					details: reflectMember(toolResult, 'details'),
				},
				{ expanded: context.expanded, isPartial: context.isPartial },
				theme,
				{ ...context, lastComponent: this.resultComponent },
			)
			if (!isComponent(body))
				throw new Error('Native result renderer returned no component.')
			this.resultComponent = body
			content.addChild(checkedNativeSlot(body))
		}
		return content
	}
}
