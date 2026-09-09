import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
	Editor,
	getKeybindings,
	ProcessTerminal,
	TuiMainScreen,
} from '@earendil-works/pi-tui'

import { attachPromptImageEditor } from '../extensions/prompt-attachments/attachment-editor.ts'
import { AttachmentStore } from '../extensions/prompt-attachments/attachment-store.ts'

import { png } from './png-fixture.ts'

import type { TestContext } from 'node:test'
import type { ImageContent } from '@earendil-works/pi-ai'

const plain = (text: string): string => text
const escapeSpaces = (path: string): string => path.replaceAll(' ', '\\ ')
const doubleQuote = (path: string): string => `"${path}"`
const singleQuote = (path: string): string => `'${path}'`

const PASTE_START = '\u001b[200~'
const PASTE_END = '\u001b[201~'

function paste(editor: Editor, text: string): void {
	editor.handleInput(`${PASTE_START}${text}${PASTE_END}`)
}

function createEditor(): Editor {
	// Real Pi paste, cursor, callbacks and submission; terminal IO never starts.
	return new Editor(new TuiMainScreen(new ProcessTerminal()), {
		borderColor: plain,
		selectList: {
			selectedPrefix: plain,
			selectedText: plain,
			description: plain,
			scrollInfo: plain,
			noMatch: plain,
		},
	})
}

function attachmentDraft(context: TestContext): {
	editor: Editor
	store: AttachmentStore
	firstPath: string
	secondPath: string
} {
	const directory = mkdtempSync(join(tmpdir(), 'attachment-paste-'))
	context.after(() => rmSync(directory, { recursive: true, force: true }))
	const firstPath = join(directory, 'first.png')
	const secondPath = join(directory, 'Screenshot 2026-09-09 at 20.04.21.png')
	writeFileSync(
		firstPath,
		Buffer.from(
			png(1, 1, () => [255, 0, 0, 255]),
			'base64',
		),
	)
	writeFileSync(
		secondPath,
		Buffer.from(
			png(1, 1, () => [0, 0, 255, 255]),
			'base64',
		),
	)
	const editor = createEditor()
	const store = new AttachmentStore(() => {})
	attachPromptImageEditor(
		editor,
		{ store, cwd: directory, styleAlias: plain },
		getKeybindings(),
	)
	return { editor, store, firstPath, secondPath }
}

void test('consecutive screenshot pastes without a space both attach on submission', context => {
	const { editor, store, firstPath, secondPath } = attachmentDraft(context)
	let submittedText = ''
	let submittedImages: ImageContent[] = []
	editor.onSubmit = text => {
		submittedText = text
		submittedImages = store.imageAttachments(text)
		store.clearCaptures()
	}
	paste(editor, firstPath)
	assert.equal(editor.getText(), '[img:1]')
	paste(editor, escapeSpaces(secondPath))
	assert.equal(editor.getText(), '[img:1][img:2]')
	assert.deepEqual(
		store.items.map(image => image.filePath),
		[firstPath, secondPath],
	)
	editor.handleInput('\r')
	assert.equal(submittedText, '[img:1][img:2]')
	assert.equal(submittedImages.length, 2)
	assert.notEqual(submittedImages[0]?.data, submittedImages[1]?.data)
	assert.equal(editor.getText(), '')
	assert.deepEqual(store.items, [])
})

for (const quotePath of [escapeSpaces, doubleQuote, singleQuote, plain]) {
	void test(`a ${quotePath.name} path is captured immediately after adjacent aliases`, context => {
		const { editor, store, firstPath, secondPath } =
			attachmentDraft(context)
		paste(editor, firstPath)
		paste(editor, firstPath)
		paste(editor, quotePath(secondPath))
		assert.equal(editor.getText(), '[img:1][img:2][img:3]')
		assert.equal(store.items.length, 3)
		assert.equal(store.items[2]?.filePath, secondPath)
	})
}

void test('aliases do not make URL or missing-path suffixes readable from disk', context => {
	const { editor, store, firstPath, secondPath } = attachmentDraft(context)
	paste(editor, firstPath)
	for (const candidate of [
		`https://example.com${firstPath}`,
		`https://example.com/[img:1]${firstPath}`,
		`/nonexistent-parent${firstPath}`,
		`prefix${firstPath}`,
		`https://example.com${escapeSpaces(secondPath)}`,
	]) {
		editor.setText('[img:1]')
		paste(editor, candidate)
		assert.equal(editor.getText(), `[img:1]${candidate}`)
		assert.equal(store.items.length, 1)
	}
})
