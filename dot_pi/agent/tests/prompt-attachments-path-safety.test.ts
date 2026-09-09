import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { AttachmentStore } from '../extensions/prompt-attachments/attachment-store.ts'

import { png } from './png-fixture.ts'

void test('URLs and missing paths cannot attach an existing local suffix', context => {
	const directory = mkdtempSync(join(tmpdir(), 'attachment-path-safety-'))
	context.after(() => rmSync(directory, { recursive: true, force: true }))
	const imagePath = join(directory, 'private.png')
	writeFileSync(
		imagePath,
		Buffer.from(
			png(1, 1, () => [1, 2, 3, 255]),
			'base64',
		),
	)
	const store = new AttachmentStore(() => {})
	const prompts = [
		`https://example.com${imagePath}`,
		`https://example.com/download?file=${imagePath}`,
		`/nonexistent-parent${imagePath}`,
		`./nonexistent-parent${imagePath}`,
		`prefix${imagePath}`,
	]
	for (const prompt of prompts) {
		assert.equal(store.ingestImagePaths(prompt, directory), prompt)
		assert.deepEqual(store.items, [])
	}
})

void test('a bracketed local path still attaches without changing its surrounding text', context => {
	const directory = mkdtempSync(join(tmpdir(), 'attachment-path-safety-'))
	context.after(() => rmSync(directory, { recursive: true, force: true }))
	const imagePath = join(directory, 'private shot.png')
	writeFileSync(
		imagePath,
		Buffer.from(
			png(1, 1, () => [1, 2, 3, 255]),
			'base64',
		),
	)
	const store = new AttachmentStore(() => {})
	assert.equal(
		store.ingestImagePaths(`see (${imagePath}).`, directory),
		'see ([img:1]).',
	)
	assert.equal(store.items[0]?.filePath, imagePath)
})
