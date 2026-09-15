import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import { visibleWidth } from '@earendil-works/pi-tui'

import { installRenderers } from '../extensions/renderers/install-renderers.ts'
import { renderActivityLine } from '../extensions/ui/activity-line.ts'

import {
	complete,
	ManualActivityTime,
	runtime,
	toolRow,
	visible,
} from './renderers-fixture.ts'

const time = new ManualActivityTime()
after(installRenderers(runtime, time.clock))

void test('read, grep and bash keep fixed counts before aligned tasks and timing at the right', () => {
	const read = toolRow('read', { path: 'file.ts' })
	const grep = toolRow('grep', { pattern: 'needle' })
	const bash = toolRow('bash', { command: 'run-tests' })
	read.markExecutionStarted()
	bash.markExecutionStarted()
	time.advance(1200)
	complete(read)
	complete(grep, 'No matches found')
	const lines = [read, grep, bash].map(
		row => visible(row.render(80))[0] ?? '',
	)
	assert.deepEqual(
		[read, grep, bash].map(row => visibleWidth(row.render(80)[0] ?? '')),
		[80, 80, 80],
	)
	assert.deepEqual(
		lines.map((line, index) =>
			line.indexOf(['file.ts', 'needle', 'run-tests'][index] ?? ''),
		),
		[17, 17, 17],
	)
	assert.deepEqual(
		lines
			.slice(0, 2)
			.map((line, index) => line.indexOf(['2l', '0l'][index] ?? '')),
		[13, 13],
	)
	assert.equal(lines[2]?.slice(6, 15).trim(), 'bash')
	assert.equal(lines[0]?.indexOf('1.2s'), 76)
	assert.equal(lines[2]?.indexOf('1.2s'), 76)
	assert.doesNotMatch(lines[1] ?? '', /\d\.\ds/u)
	complete(bash)
})

void test('read keeps the filename and range visible while retaining the full path in expanded details', () => {
	const args = {
		path: join(homedir(), '.pi/agent/extensions/renderers/tool-row.ts'),
		offset: 11,
		limit: 5,
	}
	const original = structuredClone(args)
	const row = toolRow('read', args)
	complete(row)
	const line = visible(row.render(100))[0] ?? ''
	assert.match(line, /^├── ✓ read\s+2l\s+tool-row\.ts L11-15 · ~/u)
	assert.ok(
		(visible(row.render(160))[0] ?? '').includes(
			'~/.pi/agent/extensions/renderers',
		),
	)
	assert.deepEqual(args, original)
	row.setExpanded(true)
	assert.ok(
		visible(row.render(160)).some(detail => detail.includes(args.path)),
	)
})

void test('read never abbreviates another directory that merely shares the home prefix', () => {
	const parent = `${homedir()}-other`
	const row = toolRow('read', { path: join(parent, 'file.ts') })
	complete(row)
	assert.ok((visible(row.render(160))[0] ?? '').includes(parent))
})

void test('branch rails fade into the background and tool labels use the answer accent', () => {
	const row = toolRow('read', { path: 'file.ts' })
	complete(row)
	const line = row.render(80)[0] ?? ''
	assert.match(
		line,
		/\u001b\[38;2;\d+;\d+;\d+m├\u001b\[39m\u001b\[38;2;\d+;\d+;\d+m─/u,
	)
	assert.match(line, /\u001b\[1m\u001b\[38;2;136;57;239mread/u)
	const inks = Array.from(line.matchAll(/\u001b\[38;2;(\d+);(\d+);(\d+)m/gu))
	assert.ok(
		Number(inks[1]?.[1]) > Number(inks[0]?.[1]),
		'the branch tip approaches the light background',
	)
	assert.ok(
		Number(inks[1]?.[2]) > Number(inks[0]?.[2]),
		'the branch tip is quieter than the spine',
	)
})

void test('partial output counts update in place without claiming an empty running command is done', () => {
	const row = toolRow('bash', { command: 'run-tests' })
	row.markExecutionStarted()
	row.updateResult({ content: [], isError: false }, true)
	assert.match(
		visible(row.render(80))[0] ?? '',
		/^├── \p{Script=Braille} bash/u,
	)
	assert.doesNotMatch(visible(row.render(80))[0] ?? '', /done/u)
	for (const text of ['one\ntwo', 'one\ntwo\nthree']) {
		row.updateResult(
			{ content: [{ type: 'text', text }], isError: false },
			true,
		)
		const line = visible(row.render(80))[0] ?? ''
		assert.match(line, /^├── \p{Script=Braille} bash\s+\dl\s+run-tests/u)
		assert.equal(line.indexOf('run-tests'), 17)
		assert.match(line.slice(6, 15).trim(), /^bash {3}\dl$/u)
		assert.equal(row.render(80).length, 1)
	}
	assert.match(visible(row.render(80))[0] ?? '', /3l\s+run-tests/u)
	const during = row.render(80)
	time.advance(120)
	assert.notDeepEqual(row.render(80), during)
	complete(row, 'one\ntwo\nthree')
	const settled = row.render(80)
	assert.doesNotMatch(visible(settled)[0] ?? '', /live|running/u)
	time.advance(60000)
	assert.deepEqual(row.render(80), settled)
	assert.equal(time.isScheduled, false)
})

void test('a native async tool does not claim launch completion from a partial result', () => {
	const row = toolRow('subagent', { agent: 'reviewer', async: true })
	row.markExecutionStarted()
	row.updateResult(
		{
			content: [{ type: 'text', text: 'Preparing child' }],
			isError: false,
		},
		true,
	)
	assert.match(
		visible(row.render(100))[0] ?? '',
		/^├── \p{Script=Braille} subagent/u,
	)
	assert.equal(visible(row.render(100))[0]?.slice(6, 15).trim(), 'subagent')
	complete(row, 'Child started')
	assert.match(
		visible(row.render(100))[0] ?? '',
		/^├── ✓ subagent async\s+reviewer/u,
	)
})

void test('truncation warnings remain explicit beside the fixed output count', () => {
	const row = toolRow('read', { path: 'file.ts' })
	row.updateResult({
		content: [{ type: 'text', text: Array(100).fill('line').join('\n') }],
		isError: false,
		details: { truncation: { truncated: true } },
	})
	assert.match(
		visible(row.render(80))[0] ?? '',
		/100l\s+truncated · file\.ts/u,
	)
})

void test('elapsed times change units without shifting tasks, details or the right edge', () => {
	for (const [elapsedMs, expected] of [
		[1200, '1.2s'],
		[50400, '50.4s'],
		[61000, '1m01s'],
		[3720000, '1h02m'],
	] as const) {
		const line =
			visible([
				renderActivityLine(
					{
						label: 'bash',
						subject: 'run-tests',
						summary: '',
						phase: 'running',
						elapsedMs,
					},
					80,
					0,
				),
			])[0] ?? ''
		assert.equal(line.indexOf('run-tests'), 17)
		assert.equal(line.slice(6, 15).trim(), 'bash')
		assert.equal(line.indexOf(expected) + expected.length, 80)
	}
})

for (const phase of [
	'queued',
	'running',
	'success',
	'error',
	'cancelled',
] as const) {
	void test(`${phase} stays one bounded row with Unicode tasks, warnings and long durations`, () => {
		for (let width = 0; width <= 120; width++) {
			const line = renderActivityLine(
				{
					label: 'namespace_tool'.repeat(4),
					subject: '界👩🏽\u200d💻'.repeat(40),
					summary: 'exit 7',
					warning: 'truncated · limit reached',
					phase,
					elapsedMs: 3720000,
					timeoutSeconds: 120,
				},
				width,
				120,
			)
			assert.ok(
				visibleWidth(line) <= width,
				`${phase} at ${width} columns`,
			)
			assert.doesNotMatch(line, /[\r\n]/u)
			assert.doesNotMatch(visible([line])[0] ?? '', /[▸▾]/u)
		}
	})
}
