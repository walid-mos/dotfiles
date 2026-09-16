/** One content column across rows, expanded details and standalone panels. */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import test, { after } from 'node:test'

import { generateDiffString } from '@earendil-works/pi-coding-agent'

import { installRenderers } from '../extensions/renderers/install-renderers.ts'
import { ACTIVITY_CONTENT_COLUMN } from '../extensions/ui/activity-line.ts'

import { complete, runtime, toolRow, visible } from './renderers-fixture.ts'

after(installRenderers(runtime))

const WIDTH = 104

interface RowCase {
	name: string
	args: unknown
	task: string
}

const ROW_CASES: readonly RowCase[] = [
	{ name: 'read', args: { path: 'file.ts' }, task: 'file.ts' },
	{ name: 'bash', args: { command: 'run-tests' }, task: 'run-tests' },
	{ name: 'grep', args: { pattern: 'needle' }, task: 'needle' },
	{ name: 'find', args: { pattern: '**/*.ts' }, task: '**/*.ts' },
	{ name: 'subagent', args: { agent: 'reviewer' }, task: 'reviewer' },
	{ name: 'galley_agent', args: { action: 'attach' }, task: 'attach' },
	{ name: 'frontend_console', args: { level: 'error' }, task: 'error' },
	{ name: 'bg_wait', args: { id: '9677d8d2' }, task: '9677d8d2' },
	{
		name: 'web_search',
		args: { query: 'needle query' },
		task: 'needle query',
	},
]

function firstLine(row: { render(width: number): string[] }): string {
	return visible(row.render(WIDTH))[0] ?? ''
}

void test('every ordinary row starts its task on one shared column', () => {
	const columns = ROW_CASES.map(testCase => {
		const row = toolRow(testCase.name, testCase.args)
		complete(row)
		const column = firstLine(row).indexOf(testCase.task)
		assert.ok(
			column > ACTIVITY_CONTENT_COLUMN,
			`${testCase.name} keeps its task after its identity`,
		)
		return column
	})
	assert.equal(new Set(columns).size, 1, `task columns: ${columns.join()}`)
})

void test('counts of every width keep that task column stable', () => {
	for (const text of ['a', 'a\nb', 'a\nb\nc', 'a\nb\nc\nd']) {
		const row = toolRow('read', { path: 'file.ts' })
		row.updateResult({
			content: [{ type: 'text', text }],
			isError: false,
		})
		assert.equal(firstLine(row).indexOf('file.ts'), 22)
	}
})

void test('expanded details hang off the same content column as the row', () => {
	const row = toolRow('read', { path: 'file.ts' })
	complete(row, 'returned text')
	row.setExpanded(true)
	const line = visible(row.render(WIDTH)).find(candidate =>
		candidate.includes('returned text'),
	)
	assert.equal(line?.indexOf('returned text'), ACTIVITY_CONTENT_COLUMN)
})

void test('file panels and captures align their frame text on the content column', () => {
	const before = 'const enabled = false;'
	const afterText = 'const enabled = true;'
	const edit = toolRow('edit', {
		path: join('/tmp', 'src', 'state', 'desk.ts'),
		edits: [{ oldText: before, newText: afterText }],
	})
	edit.updateResult({
		content: [{ type: 'text', text: 'ok' }],
		details: generateDiffString(before, afterText),
		isError: false,
	})
	const editLines = visible(edit.render(WIDTH))
	assert.equal(editLines[0]?.indexOf('EDIT'), ACTIVITY_CONTENT_COLUMN)
	assert.equal(
		editLines[1]?.indexOf('/tmp/src/state'),
		ACTIVITY_CONTENT_COLUMN,
	)
	assert.equal(editLines[2]?.indexOf('-'), ACTIVITY_CONTENT_COLUMN)
	assert.match(editLines.at(-1) ?? '', /^└─ {3}\+1 -1/u)

	const write = toolRow('write', { path: 'notes.md', content: '# Notes' })
	write.updateResult({
		content: [{ type: 'text', text: 'Created notes.md' }],
		isError: false,
	})
	const writeLines = visible(write.render(WIDTH))
	assert.equal(writeLines[0]?.indexOf('WRITE'), ACTIVITY_CONTENT_COLUMN)
	assert.equal(writeLines[1]?.indexOf('~'), -1)
	assert.match(writeLines.at(-1) ?? '', /^└─ {3}/u)
})

void test('panel and row frames end on the same viewport edge', () => {
	const row = toolRow('bash', { command: 'run-tests' })
	complete(row)
	const write = toolRow('write', { path: 'notes.md', content: '# Notes' })
	write.updateResult({
		content: [{ type: 'text', text: 'Created notes.md' }],
		isError: false,
	})
	for (const lines of [row.render(WIDTH), write.render(WIDTH)]) {
		for (const line of lines)
			assert.ok(
				line.length > 0 && (visible([line])[0]?.length ?? 0) <= WIDTH,
			)
	}
	assert.equal(visible(write.render(WIDTH))[0]?.length, WIDTH)
})
