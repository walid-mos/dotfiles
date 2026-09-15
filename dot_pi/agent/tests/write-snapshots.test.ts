import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createWriteTool } from '@earendil-works/pi-coding-agent'

import { MAX_CHANGE_BYTES } from '../extensions/renderers/change-document.ts'
import {
	recalledWriteDocument,
	WriteSnapshots,
} from '../extensions/renderers/write-snapshots.ts'

import type { TestContext } from 'node:test'

async function workspace(context: TestContext): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'pi-write-diff-'))
	context.after(() => rm(directory, { recursive: true, force: true }))
	return directory
}

void test('a real overwrite records additions and removals without changing execution or result', async context => {
	const directory = await workspace(context)
	await writeFile(join(directory, 'config.ts'), 'const limit = 1;\n')
	const args = { path: 'config.ts', content: 'const limit = 2;\n' }
	const beforeArgs = structuredClone(args)
	const snapshots = new WriteSnapshots()
	await snapshots.capture('write-one', args, directory)
	const tool = createWriteTool(directory)
	const output = await tool.execute('write-one', args)
	const original = structuredClone(output)
	snapshots.complete({
		toolCallId: 'write-one',
		result: output,
		isError: false,
	})
	assert.deepEqual(
		recalledWriteDocument('write-one', { ...output }, args)?.lines,
		[
			{ kind: 'removed', lineNumber: 1, text: 'const limit = 1;' },
			{ kind: 'added', lineNumber: 1, text: 'const limit = 2;' },
		],
	)
	assert.equal(
		await readFile(join(directory, 'config.ts'), 'utf8'),
		args.content,
	)
	assert.deepEqual(args, beforeArgs)
	assert.deepEqual(output, original)
	assert.equal(recalledWriteDocument('write-other', output, args), undefined)
	assert.equal(
		recalledWriteDocument('write-one', structuredClone(output), args),
		undefined,
	)
})

void test('a real new file has only genuinely added rows', async context => {
	const directory = await workspace(context)
	const args = { path: 'new.ts', content: 'first\nsecond\n' }
	const snapshots = new WriteSnapshots()
	await snapshots.capture('new-file', args, directory)
	const output = await createWriteTool(directory).execute('new-file', args)
	snapshots.complete({
		toolCallId: 'new-file',
		result: output,
		isError: false,
	})
	assert.deepEqual(
		recalledWriteDocument('new-file', output, args)?.lines.map(
			line => line.kind,
		),
		['added', 'added'],
	)
})

void test('a removed UTF-8 BOM is not mistaken for unchanged content', async context => {
	const directory = await workspace(context)
	await writeFile(join(directory, 'bom.ts'), '\ufeffsame\n')
	const args = { path: 'bom.ts', content: 'same\n' }
	const snapshots = new WriteSnapshots()
	await snapshots.capture('bom', args, directory)
	const output = await createWriteTool(directory).execute('bom', args)
	snapshots.complete({ toolCallId: 'bom', result: output, isError: false })
	assert.deepEqual(
		recalledWriteDocument('bom', output, args)?.lines.map(
			line => line.kind,
		),
		['removed', 'added'],
	)
})

for (const before of [
	Buffer.from([0, 1]),
	Buffer.alloc(MAX_CHANGE_BYTES + 1, 'a'),
]) {
	void test('binary or oversized before-images yield an honest neutral content view', async context => {
		const directory = await workspace(context)
		await writeFile(join(directory, 'target'), before)
		const args = { path: 'target', content: 'replacement' }
		const snapshots = new WriteSnapshots()
		await snapshots.capture('bounded', args, directory)
		const output = await createWriteTool(directory).execute('bounded', args)
		snapshots.complete({
			toolCallId: 'bounded',
			result: output,
			isError: false,
		})
		const document = recalledWriteDocument('bounded', output, args)
		assert.equal(document?.note, 'before snapshot unavailable')
		assert.deepEqual(document?.lines, [
			{ kind: 'written', text: 'replacement', lineNumber: 1 },
		])
	})
}

void test('failed writes and later argument rewrites never publish an applied diff', async () => {
	const snapshots = new WriteSnapshots(async () => ({
		kind: 'known',
		content: 'old',
	}))
	const args = { path: 'file', content: 'new' }
	const output = { content: [{ type: 'text', text: 'result' }] }
	await snapshots.capture('failed', args, '/tmp')
	snapshots.complete({ toolCallId: 'failed', result: output, isError: true })
	assert.equal(recalledWriteDocument('failed', output, args), undefined)
	await snapshots.capture('rewritten', args, '/tmp')
	args.content = 'different'
	snapshots.complete({
		toolCallId: 'rewritten',
		result: output,
		isError: false,
	})
	assert.equal(recalledWriteDocument('rewritten', output, args), undefined)
})

void test('clearing an in-flight snapshot prevents late state from reappearing', async () => {
	const pending = Promise.withResolvers<{ kind: 'known'; content: string }>()
	const snapshots = new WriteSnapshots(() => pending.promise)
	const args = { path: 'file', content: 'new' }
	const capture = snapshots.capture('late', args, '/tmp')
	snapshots.clear()
	pending.resolve({ kind: 'known', content: 'old' })
	await capture
	const output = { content: [{ type: 'text', text: 'written' }] }
	snapshots.complete({ toolCallId: 'late', result: output, isError: false })
	assert.equal(recalledWriteDocument('late', output, args), undefined)
})
