import assert from 'node:assert/strict'
import test, { after } from 'node:test'

import { Container, visibleWidth } from '@earendil-works/pi-tui'

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

void test('a completed collapsed bash call occupies exactly one physical row', () => {
	const row = toolRow('bash', { command: 'npm test' })
	complete(row, '287 tests passed')
	const lines = visible(row.render(80))
	assert.equal(lines.length, 1)
	assert.match(lines[0] ?? '', /^├─+ +✓ +bash\s+1l\s+npm test$/u)
})

for (const { name, args } of [
	{ name: 'read', args: { path: 'src/index.ts' } },
	{ name: 'grep', args: { pattern: 'TODO', path: 'src' } },
	{ name: 'find', args: { pattern: '**/*.ts', path: 'src' } },
	{ name: 'glob', args: { pattern: '**/*.ts' } },
	{ name: 'bash', args: { command: 'npm\ntest' } },
]) {
	void test(`${name} stays one row through argument streaming, execution, partial results and completion`, () => {
		const row = toolRow(name)
		assert.equal(row.render(80).length, 1)
		row.updateArgs(args)
		row.setArgsComplete()
		row.markExecutionStarted()
		assert.equal(row.render(80).length, 1)
		row.updateResult(
			{
				content: [{ type: 'text', text: 'partial\noutput' }],
				isError: false,
			},
			true,
		)
		assert.equal(row.render(80).length, 1)
		complete(row)
		assert.equal(row.render(80).length, 1)
	})
}

void test('collapsed rows never wrap long commands, multiline paths or wide graphemes', () => {
	const row = toolRow('bash', {
		command: `echo \n${'界👩🏽\u200d💻'.repeat(100)}`,
		timeout: 30,
	})
	complete(row)
	for (const width of [0, 1, 2, 8, 15, 30, 80, 160]) {
		const lines = row.render(width)
		assert.equal(lines.length, 1, `width ${width}`)
		assert.ok(visibleWidth(lines[0] ?? '') <= width, `bounded at ${width}`)
	}
})

void test('clicking the first physical row expands and collapses without an offset or double toggle', () => {
	const row = toolRow('bash', { command: 'printf first\nprintf second' })
	complete(row, 'first\nsecond')
	const [header] = visible(row.render(80))
	assert.equal(row.handleMouse(click())?.handled, true)
	const expanded = visible(row.render(80))
	assert.equal(expanded[0], header)
	assert.doesNotMatch(expanded[0] ?? '', /[▸▾]/u)
	assert.ok(expanded.includes('│    printf first'))
	assert.ok(expanded.includes('│    second'))
	row.handleMouse(click())
	assert.equal(row.render(80).length, 1)
})

void test('pending command details can be expanded before the first result exists', () => {
	const row = toolRow('bash', { command: 'first\nsecond' })
	row.render(80)
	row.handleMouse(click())
	assert.ok(visible(row.render(80)).includes('│    second'))
})

void test('Ctrl+O uses Pi expansion state and never changes the stored result', () => {
	const row = toolRow('read', { path: 'a.ts' })
	complete(row, 'const answer = 42')
	row.setExpanded(true)
	assert.ok(visible(row.render(80)).includes('│    const answer = 42'))
	row.setExpanded(false)
	assert.equal(row.render(80).length, 1)
})

void test('adjacent tools share a continuous gutter without blank status rows', () => {
	const chat = new Container()
	for (const command of ['one', 'two']) {
		const row = toolRow('bash', { command })
		complete(row)
		chat.addChild(row)
	}
	assert.equal(chat.render(80).length, 2)
	assert.ok(
		visible(chat.render(80)).every(line => line.startsWith('├─ ✓ bash')),
	)
})

void test('elapsed time freezes at completion and replay does not invent an execution time', () => {
	const row = toolRow('bash', { command: 'test' })
	row.markExecutionStarted()
	time.advance(2400)
	complete(row)
	const settled = visible(row.render(80))
	assert.match(settled[0] ?? '', /2\.4s/u)
	time.advance(60000)
	assert.deepEqual(visible(row.render(80)), settled)
	const replayed = toolRow('bash', { command: 'test' })
	complete(replayed)
	assert.doesNotMatch(visible(replayed.render(80))[0] ?? '', /\d\.\ds/u)
})

void test('running status animates without layout movement and stops requesting repaints on completion', () => {
	const row = toolRow('bash', { command: 'test' })
	row.markExecutionStarted()
	assert.equal(time.isScheduled, true)
	const first = row.render(80)
	time.advance(120)
	const second = row.render(80)
	assert.notDeepEqual(second, first)
	assert.equal(visibleWidth(first[0] ?? ''), visibleWidth(second[0] ?? ''))
	complete(row)
	assert.equal(time.isScheduled, false)
})

void test('failures and cancellation remain visible while their full output stays expandable', () => {
	const row = toolRow('bash', { command: 'npm test' })
	row.updateResult({
		content: [
			{ type: 'text', text: 'Tests failed\nCommand exited with code 7' },
		],
		isError: true,
	})
	assert.match(visible(row.render(80))[0] ?? '', /^├─+ +✕ +bash/u)
	row.setExpanded(true)
	assert.ok(visible(row.render(80)).includes('│    Tests failed'))
	row.setExpanded(false)
	row.updateResult({
		content: [{ type: 'text', text: 'Operation aborted' }],
		isError: true,
	})
	assert.match(visible(row.render(80))[0] ?? '', /^├─+ +⊘ +bash.*cancelled/u)
})
