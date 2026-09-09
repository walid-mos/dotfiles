import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { attachPromptImageEditor } from '../extensions/prompt-attachments/attachment-editor.ts'
import { AttachmentStore } from '../extensions/prompt-attachments/attachment-store.ts'
import { toImageAlias } from '../extensions/prompt-attachments/image-paths.ts'

import type { KeybindingsManager } from '@earendil-works/pi-coding-agent'
import type { EditorComponent } from '@earendil-works/pi-tui'

const PLAIN_ALIAS = (alias: string): string => alias

/** KeybindingsManager is duck-typed through its single `matches` method. */
const fakeKeybindings = (): KeybindingsManager =>
	// oxlint-disable-next-line nextnode/no-type-assertion typescript/no-unsafe-type-assertion
	({
		matches: (keyInput: string, keybinding: string) =>
			keybinding === 'tui.editor.deleteCharBackward' &&
			keyInput === 'backspace',
	}) as KeybindingsManager

type StubEditor = EditorComponent & {
	text: string
	upstreamChangeTexts: string[]
}

/**
 * Editor stub exposing only what attachPromptImageEditor needs. Backspace
 * mimics the pi editor: it removes exactly one trailing character.
 */
function stubEditor(
	initialText: string,
	styleAlias: (alias: string) => string = PLAIN_ALIAS,
): {
	editor: StubEditor
	store: AttachmentStore
	repaints: () => number
} {
	let repaintCount = 0
	const store = new AttachmentStore(() => {
		repaintCount += 1
	})
	const editor: StubEditor = {
		text: initialText,
		upstreamChangeTexts: [],
		getText: () => editor.text,
		setText: (nextText: string): void => {
			editor.text = nextText
			// Real pi editors fire onChange once per setText (as tools do).
			editor.onChange?.(nextText)
		},
		handleInput: (keyInput: string): void => {
			if (keyInput === 'backspace') editor.text = editor.text.slice(0, -1)
		},
		render: () => [`line: ${editor.text}`],
		invalidate: () => {},
	}
	attachPromptImageEditor(
		editor,
		{ store, cwd: '/', styleAlias },
		fakeKeybindings(),
	)
	return {
		editor,
		store,
		repaints: () => repaintCount,
	}
}

function singleImage(directory: string): string {
	const filePath = join(directory, 'shot.png')
	writeFileSync(
		filePath,
		Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]),
	)
	return filePath
}

void test('a typed image path becomes an alias plus a capture', () => {
	const directory = mkdtempSync(join(tmpdir(), 'attach-editor-'))
	const dir = directory
	const imagePath = singleImage(dir)
	const session = stubEditor('')

	// pi fires the decorated onChange for the new editor text.
	session.editor.onChange?.(`see ${imagePath}`)

	assert.equal(session.editor.text, `see ${toImageAlias(1)}`)
	assert.equal(session.store.items.length, 1)
})

void test('the alias rewrite notifies the store and settles the text', () => {
	const directory = mkdtempSync(join(tmpdir(), 'attach-editor-'))
	const imagePath = singleImage(directory)
	const session = stubEditor('')

	session.editor.onChange?.(imagePath)

	assert.equal(session.editor.text, toImageAlias(1))
	assert.ok(session.repaints() > 0, 'ingestion repaints the strip')
	// Upstream only fires once pi assigns its own handler (covered separately).
	assert.deepEqual(session.editor.upstreamChangeTexts, [])
})

void test('pi reassigning onChange keeps ingestion and call-through', () => {
	const directory = mkdtempSync(join(tmpdir(), 'attach-editor-'))
	const imagePath = singleImage(directory)
	const session = stubEditor('')

	// This is what pi does after the editor factory: it reassigns onChange.
	session.editor.onChange = (nextText: string): void => {
		session.editor.upstreamChangeTexts.push(nextText)
	}

	session.editor.onChange?.(imagePath)

	assert.equal(session.editor.text, toImageAlias(1))
	assert.equal(session.editor.upstreamChangeTexts.length, 1)
})

void test('backspacing into a trailing alias removes the whole alias', () => {
	const session = stubEditor(`draft ${toImageAlias(1)}`)

	// onChange fires while editing away the alias characters one at a time.
	session.editor.onChange?.(session.editor.text)
	session.editor.handleInput('backspace')
	session.editor.onChange?.(session.editor.text)

	assert.equal(session.editor.text, 'draft ')
	assert.equal(session.store.items.length, 0)
})

void test('editor render restyles alias tokens', () => {
	const session = stubEditor(toImageAlias(1), alias => `~${alias}~`)

	assert.deepEqual(
		[...session.editor.render(80)],
		[`line: ~${toImageAlias(1)}~`],
	)
})
