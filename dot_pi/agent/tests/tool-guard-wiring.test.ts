import assert from 'node:assert/strict'
import { test } from 'node:test'

import toolGuard from '../extensions/tool-guard/index.ts'

type Handler = (event: object, ctx: { mode: string }) => unknown

function harness(initialTools: string[]): {
	getActiveTools: () => string[]
	setActiveTools: (names: string[]) => void
	emit: (name: string, event?: object, mode?: string) => unknown
} {
	let activeTools = [...initialTools]
	const handlers = new Map<string, Handler>()
	const api = {
		on: (name: string, handler: Handler) => handlers.set(name, handler),
		getActiveTools: () => [...activeTools],
		setActiveTools: (names: string[]) => {
			activeTools = [...names]
		},
	}
	Reflect.apply(toolGuard, undefined, [api])
	return {
		...api,
		emit: (name: string, event = {}, mode = 'tui') =>
			handlers.get(name)?.(event, { mode }),
	}
}

test('interactive startup adds discovery tools and preserves extension tools across reload', () => {
	const runtime = harness([
		'read',
		'bash',
		'write',
		'edit',
		'subagent',
		'host',
		'grep',
	])
	runtime.emit('session_start')
	runtime.emit('session_start')
	assert.deepEqual(runtime.getActiveTools(), [
		'read',
		'bash',
		'write',
		'edit',
		'subagent',
		'host',
		'grep',
		'find',
		'ls',
	])
})

test('non-interactive tool contracts are not expanded', () => {
	for (const mode of ['print', 'json', 'rpc']) {
		const runtime = harness(['bash'])
		runtime.emit('session_start', {}, mode)
		assert.deepEqual(runtime.getActiveTools(), ['bash'])
	}
})

test('each shell call checks current availability, not the startup snapshot', () => {
	const runtime = harness(['bash', 'host'])
	runtime.emit('session_start')
	const event = { toolName: 'bash', input: { command: 'ls src' } }
	assert.partialDeepStrictEqual(runtime.emit('tool_call', event), {
		block: true,
	})
	runtime.setActiveTools(['bash', 'host'])
	assert.equal(runtime.emit('tool_call', event), undefined)
	assert.equal(
		runtime.emit('tool_call', { ...event, toolName: 'host' }),
		undefined,
	)
	runtime.setActiveTools(['bash', 'host', 'ls'])
	assert.partialDeepStrictEqual(
		runtime.emit('tool_call', { ...event, toolName: 'host' }),
		{ block: true },
	)
	assert.equal(
		runtime.emit('tool_call', { ...event, toolName: 'other' }),
		undefined,
	)
})
