import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { stripVTControlCharacters } from 'node:util'

import {
	CompactionSummaryMessageComponent,
	createReadTool,
	ToolExecutionComponent,
} from '@earendil-works/pi-coding-agent'
import {
	getCapabilities,
	setCapabilities,
	visibleWidth,
} from '@earendil-works/pi-tui'

import { installRenderers } from '../extensions/renderers/install-renderers.ts'
import { reflectMember } from '../extensions/ui/pi-members.ts'

import { png } from './png-fixture.ts'
import {
	click,
	complete,
	ManualActivityTime,
	runtime,
	toolRow,
	visible,
} from './renderers-fixture.ts'

void test('compaction cards use the same single-line rail and retain the complete summary on click', () => {
	const dispose = installRenderers(runtime)
	try {
		const card = new CompactionSummaryMessageComponent({
			role: 'compactionSummary',
			summary: 'Goal\nKeep this important context',
			tokensBefore: 54000,
			timestamp: 0,
		})
		const collapsed = visible(card.render(100))
		assert.equal(collapsed.length, 1)
		assert.match(
			collapsed[0] ?? '',
			/^├─+ +✓ +compact\s+54,000\s+context\s+tokens before$/u,
		)
		card.handleMouse(click())
		assert.ok(
			visible(card.render(100)).includes(
				'│   Keep this important context',
			),
		)
		card.setExpanded(false)
		assert.equal(card.render(100).length, 1)
	} finally {
		dispose()
	}
})

void test('image results remain one line collapsed and native image rendering is retained on expansion', () => {
	const capabilities = { ...getCapabilities() }
	setCapabilities({ ...capabilities, images: 'iterm2' })
	const dispose = installRenderers(runtime)
	try {
		const row = toolRow('read', { path: 'image.png' })
		const outcome = {
			content: [
				{
					type: 'image',
					mimeType: 'image/png',
					data: png(2, 2, () => [255, 0, 0, 255]),
				},
			],
			isError: false,
		}
		const original = structuredClone(outcome)
		row.updateResult(outcome)
		assert.equal(row.render(80).length, 1)
		assert.match(visible(row.render(80))[0] ?? '', /1img/u)
		assert.doesNotMatch(row.render(80).join(''), /1337;File/u)
		row.setExpanded(true)
		assert.match(row.render(80).join(''), /1337;File/u)
		const imageLine = row
			.render(80)
			.find(line => line.includes('1337;File'))
		assert.ok(imageLine)
		assert.ok(
			stripVTControlCharacters(imageLine).startsWith('│   '),
			'image shares the detail gutter',
		)
		row.setShowImages(false)
		assert.doesNotMatch(row.render(80).join(''), /1337;File/u)
		assert.deepEqual(outcome, original)
	} finally {
		dispose()
		setCapabilities(capabilities)
	}
})

void test('install/reload/dispose never stacks rails and stops abandoned running rows', () => {
	const original = ToolExecutionComponent.prototype.render
	const firstTime = new ManualActivityTime()
	const disposeFirst = installRenderers(runtime, firstTime.clock)
	const pending = toolRow('bash', { command: 'first' })
	pending.markExecutionStarted()
	assert.equal(firstTime.isScheduled, true)
	const secondTime = new ManualActivityTime()
	const disposeSecond = installRenderers(runtime, secondTime.clock)
	assert.equal(firstTime.isScheduled, false)
	disposeFirst()
	const row = toolRow('bash', { command: 'second' })
	complete(row)
	assert.equal(row.render(80).length, 1)
	assert.equal((visible(row.render(80))[0]?.match(/├/gu) ?? []).length, 1)
	disposeSecond()
	assert.equal(ToolExecutionComponent.prototype.render, original)
})

void test('unsupported Pi versions fail before altering any display methods', () => {
	const original = ToolExecutionComponent.prototype.render
	assert.throws(
		() =>
			installRenderers({
				VERSION: 'future-version',
				ToolExecutionComponent,
			}),
		/supports Pi 0\.85\.1/u,
	)
	assert.equal(ToolExecutionComponent.prototype.render, original)
})

void test('an incomplete runtime rolls back tool adaptation instead of leaving a partial install', () => {
	const original = ToolExecutionComponent.prototype.render
	assert.throws(
		() =>
			installRenderers({
				VERSION: reflectMember(runtime, 'VERSION'),
				ToolExecutionComponent,
			}),
		/rolled back/u,
	)
	assert.equal(ToolExecutionComponent.prototype.render, original)
})

void test('presentation leaves built-in schemas and real file execution intact', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'pi-renderer-execution-'))
	const read = createReadTool(directory)
	const parameters = structuredClone(read.parameters)
	const { execute } = read
	const dispose = installRenderers(runtime)
	try {
		await writeFile(join(directory, 'proof.txt'), 'first\nsecond\nthird')
		const output = await read.execute('read-proof', {
			path: 'proof.txt',
			offset: 2,
			limit: 1,
		})
		assert.equal(output.content[0]?.type, 'text')
		assert.deepEqual(read.parameters, parameters)
		assert.equal(read.execute, execute)
		const row = toolRow('read', { path: 'proof.txt', offset: 2, limit: 1 })
		row.updateResult({ ...output, isError: false })
		row.setExpanded(true)
		assert.ok(
			visible(row.render(100)).some(line => line.includes('second')),
		)
		assert.ok(row.render(15).every(line => visibleWidth(line) <= 15))
	} finally {
		dispose()
		await rm(directory, { recursive: true, force: true })
	}
})
