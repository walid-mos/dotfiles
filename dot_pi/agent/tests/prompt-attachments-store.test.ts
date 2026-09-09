import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { AttachmentStore } from '../extensions/prompt-attachments/attachment-store.ts'
import { toImageAlias } from '../extensions/prompt-attachments/image-paths.ts'

/** Build a valid PNG (signature-correct) file for capture tests. */
function fakePng(directory: string, name: string, body: string): string {
	const filePath = join(directory, name)
	writeFileSync(
		filePath,
		Uint8Array.from([0x89, 0x50, 0x4e, 0x47, ...Buffer.from(body, 'utf8')]),
	)
	return filePath
}

function textFile(directory: string, name: string): string {
	const filePath = join(directory, name)
	writeFileSync(filePath, 'plain text, not an image')
	return filePath
}

function storeWithCaptures(directory: string): {
	store: AttachmentStore
	firstPath: string
	secondPath: string
} {
	const store = new AttachmentStore(() => {})
	const firstPath = fakePng(directory, 'one.png', 'first')
	const secondPath = fakePng(directory, 'two.png', 'second')
	store.ingestImagePaths(`look ${firstPath} and`, directory)
	store.ingestImagePaths(secondPath, directory)
	return { store, firstPath, secondPath }
}

function tempDirectory(): string {
	return mkdtempSync(join(tmpdir(), 'prompt-attachments-'))
}

void test('ingests an image path and replaces it with an alias inline', () => {
	const store = new AttachmentStore(() => {})
	const directory = tempDirectory()
	const imagePath = fakePng(directory, 'shot.png', 'hello')

	const rewritten = store.ingestImagePaths(`see ${imagePath} here`, directory)

	assert.equal(
		rewritten,
		`see ${toImageAlias(1)} here`,
		'path inside surrounding text is replaced in place',
	)
	assert.equal(store.items.length, 1)
	const [capture] = store.items
	assert.ok(capture, 'one capture was recorded')
	assert.equal(capture.alias, toImageAlias(1))
	assert.equal(capture.type, 'image')
	assert.equal(capture.mimeType, 'image/png')
	assert.ok(capture.data.length > 0)
})

void test('keeps spaces: quoted paths with them still alias', () => {
	const store = new AttachmentStore(() => {})
	const directory = tempDirectory()
	const imagePath = fakePng(directory, 'with space.png', 'hi')

	const rewritten = store.ingestImagePaths(`"${imagePath}"`, directory)

	assert.equal(rewritten, toImageAlias(1))
	assert.equal(store.items.length, 1)
})

void test('punctuation around a path does not block the alias', () => {
	const store = new AttachmentStore(() => {})
	const directory = tempDirectory()
	const imagePath = fakePng(directory, 'chart.png', 'x')

	const rewritten = store.ingestImagePaths(`(${imagePath}),`, directory)

	assert.equal(rewritten, `(${toImageAlias(1)}),`)
})

void test('ingests an unquoted macOS screenshot path with spaces', () => {
	const store = new AttachmentStore(() => {})
	const directory = tempDirectory()
	const imagePath = fakePng(
		directory,
		'Screenshot 2026-09-09 at 16.28.10.png',
		'full',
	)

	const rewritten = store.ingestImagePaths(
		`look at ${imagePath} now`,
		directory,
	)

	assert.equal(rewritten, `look at ${toImageAlias(1)} now`)
	assert.equal(store.items.length, 1)
	const [capture] = store.items
	assert.equal(capture?.filePath, imagePath)
})

void test('a spaced path and a plain path each get their own alias', () => {
	const store = new AttachmentStore(() => {})
	const directory = tempDirectory()
	const spacedPath = fakePng(directory, 'a 1.png', 'spaced')
	const plainPath = fakePng(directory, 'b.png', 'plain')

	const rewritten = store.ingestImagePaths(
		`${spacedPath} plus ${plainPath}`,
		directory,
	)

	assert.equal(rewritten, `${toImageAlias(1)} plus ${toImageAlias(2)}`)
	assert.equal(store.items.length, 2)
})

void test('punctuation after a spaced path stays outside the alias', () => {
	const store = new AttachmentStore(() => {})
	const directory = tempDirectory()
	const imagePath = fakePng(directory, 'shot 1.png', 'x')

	const rewritten = store.ingestImagePaths(`(${imagePath}).`, directory)

	assert.equal(rewritten, `(${toImageAlias(1)}).`)
})

void test('an unquoted spaced path that does not exist stays untouched', () => {
	const store = new AttachmentStore(() => {})
	const missingPath = join(tempDirectory(), 'Screenshot 2026-09-09.png')

	const rewritten = store.ingestImagePaths(`see ${missingPath} ok`, '/tmp')

	assert.equal(rewritten, `see ${missingPath} ok`)
	assert.equal(store.items.length, 0)
})

void test('numbers advance per capture and restart after all aliases vanish', () => {
	const directory = tempDirectory()
	const { store } = storeWithCaptures(directory)
	const [firstCapture, secondCapture] = [...store.items]

	assert.equal(firstCapture?.alias, toImageAlias(1))
	assert.equal(secondCapture?.alias, toImageAlias(2))

	// Drop both aliases -> captures reset -> numbering restarts at 1.
	store.retainReferencedAliases('')
	assert.equal(store.items.length, 0)

	const thirdPath = fakePng(directory, 'three.png', 'third')
	const rewritten = store.ingestImagePaths(thirdPath, directory)
	assert.equal(rewritten, toImageAlias(1))
})

void test('editing out one alias drops only its capture', () => {
	const directory = tempDirectory()
	const { store } = storeWithCaptures(directory)

	store.retainReferencedAliases(toImageAlias(2))
	assert.equal(store.items.length, 1)
	assert.equal([...store.items][0]?.alias, toImageAlias(2))
})

void test('imageAttachments returns payloads for referenced aliases only', () => {
	const directory = tempDirectory()
	const { store } = storeWithCaptures(directory)

	const payload = store.imageAttachments(toImageAlias(2))

	assert.deepEqual(
		payload.map(image => image.mimeType),
		['image/png'],
	)
	const [attach] = payload
	assert.ok(attach, 'referenced alias resolves to an attachment')
	assert.deepEqual([...Buffer.from(attach.data, 'base64')].slice(4), [
		...Buffer.from('second', 'utf8'),
	])
})

void test('clearCaptures consumes every capture, numbering and scroll', () => {
	const directory = tempDirectory()
	const { store } = storeWithCaptures(directory)
	store.scrollStrip(1)

	store.clearCaptures()

	assert.equal(store.items.length, 0)
	assert.equal(store.scrollOffset, 0)
	assert.deepEqual(store.imageAttachments(toImageAlias(1)), [])

	// Numbering restarts, exactly like after pruning every alias.
	const nextPath = fakePng(directory, 'again.png', 'next')
	const rewritten = store.ingestImagePaths(nextPath, directory)
	assert.equal(rewritten, toImageAlias(1))
})

void test('paths that are not images stay untouched', () => {
	const store = new AttachmentStore(() => {})
	const directory = tempDirectory()
	const filePath = textFile(directory, 'notes.txt')

	const rewritten = store.ingestImagePaths(`docs ${filePath}`, directory)

	assert.equal(rewritten, `docs ${filePath}`)
	assert.equal(store.items.length, 0)
})

void test('missing files do not disturb the prompt', () => {
	const store = new AttachmentStore(() => {})
	const missingPath = join(tempDirectory(), 'gone.png')

	const rewritten = store.ingestImagePaths(missingPath, '/tmp')

	assert.equal(rewritten, missingPath)
	assert.equal(store.items.length, 0)
})

void test('strip scrolling clamps to the capture range', () => {
	const directory = tempDirectory()
	const { store } = storeWithCaptures(directory)

	store.scrollStrip(-1)
	assert.equal(store.scrollOffset, 0, 'scroll floor is 0')
	store.scrollStrip(1)
	assert.equal(store.scrollOffset, 1)
	store.scrollStrip(1)
	assert.equal(
		store.scrollOffset,
		1,
		'scroll ceiling is the last capture index',
	)
})

void test('capture payload round-trips the original file bytes', () => {
	const store = new AttachmentStore(() => {})
	const directory = tempDirectory()
	const imagePath = fakePng(directory, 'tiny.png', 'payload-bytes')

	store.ingestImagePaths(imagePath, directory)

	assert.equal(store.items.length, 1)
	const [payload] = store.items
	assert.ok(payload, 'one capture was recorded')
	assert.deepEqual([...Buffer.from(payload.data, 'base64')].slice(4), [
		...Buffer.from('payload-bytes', 'utf8'),
	])
	assert.ok((payload.imageId ?? 0) >= 1)
})
