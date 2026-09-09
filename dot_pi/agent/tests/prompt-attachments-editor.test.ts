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
			(keybinding === 'tui.editor.deleteCharBackward' &&
				keyInput === 'backspace') ||
			(keybinding === 'tui.input.submit' && keyInput === 'enter'),
	}) as KeybindingsManager

type StubEditor = EditorComponent & {
	text: string
	upstreamChangeTexts: string[]
}

/**
 * Editor stub exposing only what attachPromptImageEditor needs. Key handling
 * mimics the pi editor: backspace removes one trailing character, ctrl+u
 * deletes to line start, and every handled key fires onChange at the end.
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
			if (keyInput === 'backspace') {
				if (!editor.text.length) return
				editor.text = editor.text.slice(0, -1)
				editor.onChange?.(editor.text)
				return
			}
			if (keyInput === 'ctrl+u') {
				editor.text = ''
				editor.onChange?.('')
				return
			}
			if (keyInput === 'enter') {
				const submitted = editor.text
				editor.text = ''
				// pi-tui submitValue(): onChange('') BEFORE onSubmit(result).
				editor.onChange?.('')
				editor.onSubmit?.(submitted)
			}
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

void test('the submit clear keeps pending captures for the input event', () => {
	const directory = mkdtempSync(join(tmpdir(), 'attach-editor-'))
	const imagePath = singleImage(directory)
	const session = stubEditor('')

	session.editor.onChange?.(`see ${imagePath}`)
	assert.equal(session.store.items.length, 1)

	// pi-tui submitValue() fires onChange('') BEFORE onSubmit(result).
	session.editor.handleInput('enter')

	assert.equal(
		session.store.imageAttachments(toImageAlias(1)).length,
		1,
		'a cleared draft is a submit, not a deletion of every capture',
	)
})

void test('clearing the draft with a delete key drops its captures immediately', () => {
	const directory = mkdtempSync(join(tmpdir(), 'attach-editor-'))
	const imagePath = singleImage(directory)
	const session = stubEditor('')

	session.editor.onChange?.(`see ${imagePath}`)
	assert.equal(session.store.items.length, 1)

	session.editor.handleInput('ctrl+u')

	assert.equal(
		session.store.items.length,
		0,
		'a draft emptied by deleting must not keep its capture pending',
	)
})

void test('a programmatic editor clear drops its captures immediately', () => {
	const directory = mkdtempSync(join(tmpdir(), 'attach-editor-'))
	const imagePath = singleImage(directory)
	const session = stubEditor('')

	session.editor.onChange?.(`see ${imagePath}`)
	session.editor.setText('')

	assert.equal(
		session.store.items.length,
		0,
		'an editor cleared outside a keypress is a deletion too',
	)
})

void test('a cleared draft frees the alias numbering for the next capture', () => {
	const directory = mkdtempSync(join(tmpdir(), 'attach-editor-'))
	const imagePath = singleImage(directory)
	const session = stubEditor('')

	session.editor.onChange?.(`see ${imagePath}`)
	session.editor.handleInput('ctrl+u')
	session.editor.onChange?.(`next ${imagePath}`)

	assert.equal(session.editor.text, `next ${toImageAlias(1)}`)
})

void test('editing all text away except on submit still drops captures', () => {
	const directory = mkdtempSync(join(tmpdir(), 'attach-editor-'))
	const imagePath = singleImage(directory)
	const session = stubEditor('')

	session.editor.onChange?.(`see ${imagePath} now`)

	session.editor.onChange?.('nothing here anymore')

	assert.equal(session.store.items.length, 0)
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
