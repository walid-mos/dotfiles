import assert from 'node:assert/strict'
import { test } from 'node:test'

import containerSandbox from '../extensions/container-sandbox/index.ts'

type Handler = (event: object, context: object) => unknown

function harness(): {
	tools: Map<string, { promptSnippet?: string; promptGuidelines?: string[] }>
	active: () => string[]
	start: () => Promise<unknown>
} {
	let active = ['read', 'bash', 'host', 'subagent', 'grep']
	const tools = new Map<
		string,
		{ name: string; promptSnippet?: string; promptGuidelines?: string[] }
	>()
	const handlers = new Map<string, Handler>()
	Reflect.apply(containerSandbox, undefined, [
		{
			registerFlag: () => undefined,
			registerTool: (tool: { name: string }) =>
				tools.set(tool.name, tool),
			registerCommand: () => undefined,
			on: (name: string, handler: Handler) => handlers.set(name, handler),
			getFlag: () => true,
			getActiveTools: () => [...active],
			setActiveTools: (names: string[]) => {
				active = [...names]
			},
		},
	])
	return {
		tools,
		active: () => active,
		start: async () => handlers.get('session_start')?.({}, {}),
	}
}

test('without a container host is hidden while other active tools survive', async () => {
	const runtime = harness()
	await runtime.start()
	assert.deepEqual(runtime.active(), ['read', 'bash', 'subagent', 'grep'])
})

test('host prompt metadata advertises administration, not file inspection', () => {
	const runtime = harness()
	assert.match(
		runtime.tools.get('host')?.promptSnippet ?? '',
		/macOS administration only/,
	)
	assert.doesNotMatch(
		runtime.tools.get('host')?.promptSnippet ?? '',
		/ls, grep, find/,
	)
	assert.match(
		runtime.tools.get('host')?.promptGuidelines?.join(' ') ?? '',
		/Never use.*host.*project work/,
	)
})
