/** Compaction is a transcript component, not a tool registration. Give it the same activity shell. */
import { stripVTControlCharacters } from 'node:util'

import { Text } from '@earendil-works/pi-tui'

import { ActivityDetails } from '../ui/activity-details.ts'
import { renderActivityLine } from '../ui/activity-line.ts'
import { uiTheme } from '../ui/design-system/theme.ts'
import { patchPiComponent } from '../ui/pi-component-patch.ts'
import { invokePiMethod, reflectMember } from '../ui/pi-members.ts'

import { payloadNumber, payloadText } from './tool-payload.ts'

import type { Component } from '@earendil-works/pi-tui'

function compactionDetails(
	host: object,
	bodies: WeakMap<object, Component>,
): Component {
	const cached = bodies.get(host)
	if (cached) return cached
	const summary = payloadText(reflectMember(host, 'message'), 'summary')
	const body = new ActivityDetails(
		new Text(uiTheme.fg('output', stripVTControlCharacters(summary)), 0, 0),
	)
	bodies.set(host, body)
	return body
}

function renderCompaction(
	host: object,
	width: number,
	bodies: WeakMap<object, Component>,
): string[] {
	const message = reflectMember(host, 'message')
	const tokens = payloadNumber(message, 'tokensBefore')
	const isExpanded = reflectMember(host, 'expanded') === true
	const header = renderActivityLine(
		{
			label: 'compact',
			subject: 'context',
			annotation: typeof tokens === 'number' ? 'tokens before' : '',
			summary:
				typeof tokens === 'number'
					? tokens.toLocaleString('en-US')
					: 'compacted',
			phase: 'success',
		},
		width,
		0,
	)
	if (!isExpanded) return [header]
	return [header, ...compactionDetails(host, bodies).render(width)]
}

export function installCompactionSurface(component: unknown): () => void {
	const bodies = new WeakMap<object, Component>()
	return patchPiComponent(component, 'pi.renderers.compaction', {
		invalidate(host, original, args) {
			bodies.delete(host)
			return original(...args)
		},
		render: (host, _original, args) =>
			renderCompaction(
				host,
				typeof args[0] === 'number' ? args[0] : 0,
				bodies,
			),
		handleMouse(host, _original, args) {
			const [event] = args
			if (
				payloadText(event, 'type') !== 'click' ||
				payloadText(event, 'button') !== 'left'
			)
				return undefined
			if (payloadNumber(event, 'y') !== 0) return undefined
			invokePiMethod(
				host,
				'setExpanded',
				reflectMember(host, 'expanded') !== true,
			)
			return { handled: true }
		},
	})
}
