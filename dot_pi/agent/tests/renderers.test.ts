import assert from 'node:assert/strict'
import test, { after } from 'node:test'

import { Text } from '@earendil-works/pi-tui'

import { installRenderers } from '../extensions/renderers/install-renderers.ts'

import {
	click,
	complete,
	ManualActivityTime,
	runtime,
	toolRow,
	visible,
} from './renderers-fixture.ts'

const time = new ManualActivityTime()
after(installRenderers(runtime, time.clock))

for (const [name, label] of [
	['subagent', 'subagent'],
	['compact', 'compact'],
	['web_search', 'web search'],
	['fetch_content', 'fetch content'],
	['source_check', 'source check'],
	['get_search_content', 'get search content'],
	['galley_agent', 'galley'],
	['bg_wait', 'wait'],
	['subagent_supervisor', 'supervisor'],
	['frontend_open', 'open'],
	['frontend_act', 'act'],
	['frontend_screenshot', 'shot'],
	['frontend_console', 'console'],
	['frontend_eval', 'eval'],
	['ask_user_question', 'ask user question'],
	['ls', 'ls'],
	['powershell', 'powershell'],
	['new_mcp_tool', 'new mcp tool'],
] as const) {
	void test(`${name} cannot fall through to Pi's boxed tool fallback`, () => {
		const row = toolRow(name, { action: 'list' })
		complete(row, 'Original tool output')
		const lines = visible(row.render(80))
		assert.equal(lines.length, 1)
		assert.ok((lines[0] ?? '').startsWith(`├── ✓ ${label} `))
		row.setExpanded(true)
		assert.ok(visible(row.render(80)).includes('│   Original tool output'))
	})
}

void test('the galley attachment reads as a desk identity and its live state', () => {
	const row = toolRow('galley_agent', {
		action: 'attach',
		session: 'feat-1',
		repo: '/tmp/repo',
	})
	row.updateResult({
		content: [{ type: 'text', text: 'Listening: /tmp/repo / feat-1' }],
		details: { connected: true },
		isError: false,
	})
	assert.match(
		visible(row.render(100))[0] ?? '',
		/galley\s+live\s+attach feat-1 repo/u,
	)
})

void test('browser and wait vocabulary names the subject, not the tool parameter', () => {
	const console = toolRow('frontend_console', { level: 'error', max: 50 })
	complete(console, 'one\ntwo\nthree')
	assert.match(
		visible(console.render(100))[0] ?? '',
		/console\s+3l\s+error last 50/u,
	)
	const open = toolRow('frontend_open', { url: 'http://localhost:5173/x' })
	complete(open)
	assert.match(
		visible(open.render(100))[0] ?? '',
		/open\s+2l\s+localhost:5173\/x/u,
	)
	const wait = toolRow('bg_wait', { id: 'abc123', timeoutMs: 600000 })
	complete(wait, 'finished')
	assert.match(visible(wait.render(100))[0] ?? '', /wait\s+1l\s+abc123/u)
	assert.match(visible(wait.render(100))[0] ?? '', /600s max/u)
})

void test('an unknown tool reads its own name and first argument, never a raw identifier', () => {
	const row = toolRow('new_mcp_namespace_tool', { workspace: 'ws-1' })
	complete(row, 'done')
	assert.match(
		visible(row.render(100))[0] ?? '',
		/new mcp namespace tool\s+1l\s+ws-1/u,
	)
	const question = toolRow('ask_user_question', {
		questions: [{ id: 'scope', prompt: 'Which tools?' }],
	})
	complete(question, 'Answered: all-custom')
	assert.match(
		visible(question.render(100))[0] ?? '',
		/ask user question\s+1l\s+Which tools\?/u,
	)
})

void test('write and edit use their own panels even without diffs, retaining full native output', () => {
	for (const name of ['write', 'edit']) {
		const row = toolRow(name, { action: 'list' })
		complete(row, 'Original tool output')
		assert.ok(
			visible(row.render(100))[0]?.startsWith(`┌─ ${name.toUpperCase()}`),
		)
		row.setExpanded(true)
		assert.ok(
			visible(row.render(100)).some(line =>
				line.includes('Original tool output'),
			),
		)
	}
})

void test('subagent guide shows the action and topic without the old full-output hint block', () => {
	const row = toolRow(
		'subagent',
		{ action: 'guide', topic: 'workflows' },
		{
			renderCall: () => new Text('subagent guide', 0, 0),
			renderResult: (_result, options) =>
				new Text(
					options.expanded
						? 'FULL WORKFLOW GUIDE'
						: 'Press ctrl+o for full output',
					0,
					0,
				),
		},
	)
	complete(row, 'Workflow guide')
	const collapsed = visible(row.render(100))
	assert.equal(collapsed.length, 1)
	assert.match(collapsed[0] ?? '', /subagent\s+1l\s+guide\s+workflows/u)
	assert.doesNotMatch(collapsed[0] ?? '', /Press ctrl\+o/u)
	row.handleMouse(click())
	assert.ok(visible(row.render(100)).includes('│   FULL WORKFLOW GUIDE'))
})

void test('native call/result slots retain their shared state and distinct component caches', () => {
	const callComponent = new Text('call fresh', 0, 0)
	const resultComponent = new Text('result fresh', 0, 0)
	const row = toolRow(
		'custom',
		{},
		{
			renderCall(_args, _theme, context) {
				Reflect.set(context.state, 'caption', 'native details')
				callComponent.setText(
					context.lastComponent === callComponent
						? 'call reused'
						: 'call fresh',
				)
				return callComponent
			},
			renderResult(_toolResult, _options, _theme, context) {
				const caption: unknown = Reflect.get(context.state, 'caption')
				const reuse =
					context.lastComponent === resultComponent
						? 'result reused'
						: 'result fresh'
				resultComponent.setText(
					`${reuse}: ${typeof caption === 'string' ? caption : 'missing state'}`,
				)
				return resultComponent
			},
		},
	)
	complete(row)
	row.setExpanded(true)
	assert.ok(
		visible(row.render(80)).includes('│   result fresh: native details'),
	)
	row.invalidate()
	const refreshed = visible(row.render(80))
	assert.ok(refreshed.includes('│   call reused'))
	assert.ok(refreshed.includes('│   result reused: native details'))
})

void test('crashing third-party detail renderers fall back to readable output rather than hide it', () => {
	const row = toolRow(
		'broken',
		{},
		{
			renderResult() {
				throw new Error('plugin bug')
			},
		},
	)
	complete(row, 'Important error evidence')
	row.setExpanded(true)
	assert.ok(visible(row.render(80)).includes('│   Important error evidence'))
})

void test('a native call renderer without a result renderer cannot discard the result', () => {
	const row = toolRow(
		'partial_plugin',
		{},
		{ renderCall: () => new Text('CALL', 0, 0) },
	)
	complete(row, 'Must remain visible')
	row.setExpanded(true)
	assert.ok(visible(row.render(80)).includes('│   Must remain visible'))
})

void test('read ranges use offset plus count, not offset minus count', () => {
	const row = toolRow('read', { path: 'a.ts', offset: 11, limit: 5 })
	complete(row)
	assert.match(visible(row.render(100))[0] ?? '', /L11-15/u)
})

void test('empty search results are zero, not one line counted as a match', () => {
	const grep = toolRow('grep', { pattern: 'absent' })
	complete(grep, 'No matches found')
	assert.match(visible(grep.render(100))[0] ?? '', /0l/u)
	const glob = toolRow('find', { pattern: '**/*.none' })
	complete(glob, 'No files found matching pattern')
	assert.match(visible(glob.render(100))[0] ?? '', /0f/u)
})

void test('truncation stays visible collapsed and the full-output path remains available expanded', () => {
	const row = toolRow('bash', { command: 'large-output' })
	row.updateResult({
		content: [{ type: 'text', text: 'tail' }],
		isError: false,
		details: {
			truncation: { truncated: true },
			fullOutputPath: '/tmp/full-output.log',
		},
	})
	assert.match(visible(row.render(100))[0] ?? '', /truncated/u)
	row.setExpanded(true)
	assert.ok(
		visible(row.render(100)).includes(
			'│   Full output: /tmp/full-output.log',
		),
	)
})
