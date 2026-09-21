/** Atomically bind the supported Pi display surfaces; expose one disposal boundary for reload/shutdown. */
import { ActivityClock } from '../ui/activity-clock.ts'
import { reflectMember, typedHost } from '../ui/pi-members.ts'

import { installAssistantSurface } from './assistant-surface.ts'
import { installCompactionSurface } from './compaction-surface.ts'
import { installToolSurface } from './tool-surface.ts'

const INSTALLATION = Symbol.for('pi.renderers.installation')

function installSurfaces(runtime: unknown, clock: ActivityClock): () => void {
	const restores: (() => void)[] = []
	const restore = (): void => {
		clock.dispose()
		for (const dispose of restores.toReversed()) dispose()
	}
	try {
		restores.push(
			installToolSurface(
				reflectMember(runtime, 'ToolExecutionComponent'),
				clock,
			),
		)
		restores.push(
			installCompactionSurface(
				reflectMember(runtime, 'CompactionSummaryMessageComponent'),
			),
		)
		restores.push(
			installAssistantSurface(
				reflectMember(runtime, 'AssistantMessageComponent'),
			),
		)
		return restore
	} catch (cause) {
		restore()
		throw new Error(
			'renderers: display adapter installation failed; all patches rolled back.',
			{ cause },
		)
	}
}

export function installRenderers(
	runtime: unknown,
	clock = new ActivityClock(),
): () => void {
	const prototype = typedHost(
		reflectMember(
			reflectMember(runtime, 'ToolExecutionComponent'),
			'prototype',
		),
	)
	if (!prototype)
		throw new Error(
			'renderers: ToolExecutionComponent is unavailable in the running Pi module.',
		)
	const previous: unknown = Reflect.get(prototype, INSTALLATION)
	if (typeof previous === 'function') previous()
	const restore = installSurfaces(runtime, clock)
	const dispose = (): void => {
		if (Reflect.get(prototype, INSTALLATION) !== dispose) return
		restore()
		Reflect.deleteProperty(prototype, INSTALLATION)
	}
	Reflect.set(prototype, INSTALLATION, dispose)
	return dispose
}
