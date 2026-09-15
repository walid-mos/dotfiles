import assert from 'node:assert/strict'
import test, { after } from 'node:test'

import { generateDiffString } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'

import { installRenderers } from '../extensions/renderers/install-renderers.ts'
import { ChangeBlock } from '../extensions/ui/change-block.ts'
import { hexToRgb } from '../extensions/ui/design-system/terminal-color.ts'
import { UI_COLOR, uiTheme } from '../extensions/ui/design-system/theme.ts'
import { MutationPanel } from '../extensions/ui/mutation-panel.ts'
import { terminalLineWidth } from '../extensions/ui/terminal-text.ts'

import {
	click,
	complete,
	runtime,
	toolRow,
	toolTranscript,
	visible,
} from './renderers-fixture.ts'

after(installRenderers(runtime))

function changedRow(): ReturnType<typeof toolRow> {
	const before = Array.from(
		{ length: 14 },
		(_, index) => `const before${String(index)} = false;`,
	).join('\n')
	const afterText = Array.from(
		{ length: 14 },
		(_, index) => `const after${String(index)} = true;`,
	).join('\n')
	const row = toolRow('edit', {
		path: 'example.ts',
		edits: [{ oldText: before, newText: afterText }],
	})
	row.updateResult({
		content: [{ type: 'text', text: 'Successfully replaced text.' }],
		details: generateDiffString(before, afterText),
		isError: false,
	})
	return row
}

void test('successful edit exposes a bounded numbered diff instead of only its receipt', () => {
	const row = changedRow()
	const lines = visible(row.render(100))
	assert.equal(lines.length, 11)
	assert.match(lines[0] ?? '', /^┌─ EDIT · example\.ts .*┐$/u)
	assert.ok(lines[1]?.includes('Applied'))
	assert.match(lines[2] ?? '', /^│ - +1 │ const before0 = false;.*│$/u)
	assert.match(lines.at(-1) ?? '', /^└─.*┘$/u)
	assert.ok(lines.at(-1)?.includes('+14 -14'))
	assert.ok(lines.at(-1)?.includes('click / Ctrl+O'))
	assert.doesNotMatch(lines.join('\n'), /Successfully replaced|[╭╮]/u)
})

void test('clicking a preview expands the same code template and keeps its visible prefix unchanged', () => {
	const row = changedRow()
	const transcript = toolTranscript([row])
	const preview = transcript.render(100)
	assert.equal(row.handleMouse(click(2))?.handled, true)
	const expanded = transcript.render(100)
	assert.deepEqual(
		expanded.slice(0, preview.length - 1),
		preview.slice(0, -1),
	)
	assert.ok(
		visible(expanded).some(line => line.includes('const after13 = true;')),
	)
	assert.match(visible(expanded).at(-1) ?? '', /^└─.*┘$/u)
	for (const type of ['press', 'drag', 'release', 'move'] as const)
		row.handleMouse({ ...click(2), type })
	assert.deepEqual(
		transcript.render(100),
		expanded,
		'selection gestures must not fold the panel',
	)
	assert.equal(row.handleMouse(click(2))?.handled, true)
	assert.deepEqual(transcript.render(100), preview)
	assert.equal(row.handleMouse(click(1))?.handled, true)
	transcript.render(100)
	assert.equal(row.handleMouse(click(expanded.length - 1))?.handled, true)
	assert.deepEqual(transcript.render(100), preview)
})

void test('native keyboard expansion uses the same diff and keeps the tool-chain rail coherent', () => {
	const row = changedRow()
	const next = toolRow('read', { path: 'next.ts' })
	complete(next)
	const previous = toolRow('bash', { command: 'check' })
	complete(previous)
	const transcript = toolTranscript([previous, row, next])
	const preview = visible(transcript.render(100))
	assert.match(preview[0] ?? '', /^╰──/u)
	assert.match(preview[1] ?? '', /^┌─ EDIT/u)
	assert.match(preview[11] ?? '', /^└─.*┘$/u)
	assert.match(preview.at(-1) ?? '', /^╰──/u)
	row.setExpanded(true)
	const expanded = visible(transcript.render(100))
	assert.ok(expanded.some(line => line.includes('const after13 = true;')))
	assert.match(expanded.at(-1) ?? '', /^╰──/u)
})

void test('native renderers mounted while pending still receive completion before the diff takes over', () => {
	const nativePhases: string[] = []
	const row = toolRow(
		'edit',
		{ path: 'a.ts' },
		{
			renderCall: () => new Text('native call', 0, 0),
			renderResult: (_output, options) => {
				nativePhases.push(options.isPartial ? 'partial' : 'complete')
				return new Text('native result', 0, 0)
			},
		},
	)
	row.setExpanded(true)
	row.updateResult(
		{ content: [{ type: 'text', text: 'pending' }], isError: false },
		true,
	)
	row.updateResult({
		content: [{ type: 'text', text: 'done' }],
		details: { diff: '-1 old\n+1 new' },
		isError: false,
	})
	assert.deepEqual(nativePhases, ['partial', 'complete'])
	const lines = visible(row.render(100)).join('\n')
	assert.match(lines, /1 │ new/u)
	assert.doesNotMatch(lines, /native call|native result/u)
})

void test('soft added/removed backgrounds fill equal-width rows while code keeps readable house ink', () => {
	const block = new ChangeBlock({
		lines: [
			{ kind: 'removed', lineNumber: 42, text: '  old();' },
			{ kind: 'added', lineNumber: 42, text: '  next();' },
		],
		note: '',
	})
	const panel = new MutationPanel(
		() => ({
			label: 'edit',
			subject: 'sample.ts',
			phase: 'success',
			summary: '',
		}),
		block,
		block.renderFooter(),
	)
	const lines = panel.render(60)
	assert.equal(terminalLineWidth(lines[2] ?? ''), 60)
	assert.equal(terminalLineWidth(lines[3] ?? ''), 60)
	assert.equal(
		lines[2]?.match(/\x1b\[48;2;(\d+;\d+;\d+)m/u)?.[1],
		hexToRgb(UI_COLOR.diffRemovedBg).join(';'),
	)
	assert.equal(
		lines[3]?.match(/\x1b\[48;2;(\d+;\d+;\d+)m/u)?.[1],
		hexToRgb(UI_COLOR.diffAddedBg).join(';'),
	)
	assert.ok(lines[3]?.includes(uiTheme.fg('text', '  next();')))
	assert.match(visible(lines)[3] ?? '', /^│ \+ +42 │   next\(\);.*│$/u)
})

void test('Unicode, control bytes and long code lines remain bounded without executing terminal escapes', () => {
	const block = new ChangeBlock({
		lines: [
			{
				kind: 'added',
				lineNumber: 1234,
				text: `  const label = "${'界👩🏽\u200d💻'.repeat(20)}";`,
			},
			{
				kind: 'removed',
				lineNumber: 1234,
				text: '\x1b]52;c;clipboard\x07',
			},
		],
		note: '',
	})
	block.setView('expanded')
	for (let width = 0; width <= 100; width++) {
		const lines = block.render(width)
		assert.ok(lines.every(line => terminalLineWidth(line) <= width))
		assert.ok(lines.every(line => !line.includes('\x1b]52;')))
	}
	assert.ok(
		visible(block.render(100)).some(line =>
			line.includes('\\x1b]52;c;clipboard\\x07'),
		),
	)
})

void test('very many short source lines still produce a bounded preview without argument-stack overflow', () => {
	const lines = Array.from({ length: 140_000 }, (_, index) => ({
		kind: 'written' as const,
		lineNumber: index + 1,
		text: '',
	}))
	const block = new ChangeBlock({ lines, note: '' })
	assert.equal(block.render(40).length, 8)
	assert.match(block.renderFooter(), /140000l shown/u)
})

void test('pending or failed writes never show an applied diff', () => {
	const row = toolRow('write', {
		path: 'new.ts',
		content: 'const value = 1;',
	})
	assert.match(visible(row.render(100))[0] ?? '', /^┌─ WRITE/u)
	assert.ok(visible(row.render(100)).some(line => line.includes('Preparing')))
	row.updateResult({
		content: [{ type: 'text', text: 'Permission denied' }],
		isError: true,
	})
	const failed = visible(row.render(100)).join('\n')
	assert.match(failed, /Failed/u)
	assert.match(failed, /Permission denied/u)
	assert.doesNotMatch(row.render(100).join('\n'), /\x1b\[48;2;/u)
})

void test('restored writes without a baseline show actual content neutrally, not a fictional all-added diff', () => {
	const row = toolRow('write', {
		path: 'restored.ts',
		content: 'saved source\n',
	})
	complete(row, 'Written.')
	const lines = visible(row.render(100))
	assert.ok(lines.some(line => /1 │ saved source/u.test(line)))
	assert.ok(lines.at(-1)?.includes('before snapshot unavailable'))
	assert.doesNotMatch(lines.join('\n'), /\+1|-1/u)
})
