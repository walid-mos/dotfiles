import assert from 'node:assert/strict'
import test from 'node:test'

import { attachDoubleEscapeClear } from '../extensions/double-escape-clear/escape-editor.ts'
import {
	DOUBLE_ESCAPE_WINDOW_MS,
	EscapePacer,
} from '../extensions/double-escape-clear/escape-pacer.ts'

import type { KeybindingsManager } from '@earendil-works/pi-coding-agent'
import type { EditorComponent } from '@earendil-works/pi-tui'

const ESCAPE = 'escape'
const LETTER_A = 'a'

/** KeybindingsManager is duck-typed through its single `matches` method. */
const fakeKeybindings = (): KeybindingsManager =>
	// oxlint-disable-next-line nextnode/no-type-assertion typescript/no-unsafe-type-assertion
	({
		matches: (keyInput: string, keybinding: string) =>
			keybinding === 'app.interrupt' && keyInput === ESCAPE,
	}) as KeybindingsManager

/** Deterministic clock returning each value once, then clamped at the end. */
function injectedClock(ticks: readonly number[]): () => number {
	let index = 0
	return () => ticks[index++] ?? Number.MAX_SAFE_INTEGER
}

type StubEditor = EditorComponent & {
	text: string
	basePresses: string[]
	isShowingAutocomplete?: () => boolean
}

/** Editor stub exposing only what the extension uses; base presses are logged. */
function stubEditor(initialText: string): StubEditor {
	const editor: StubEditor = {
		text: initialText,
		basePresses: [],
		getText: () => editor.text,
		setText: (nextText: string): void => {
			editor.text = nextText
		},
		handleInput: (keyInput: string): void => {
			editor.basePresses.push(keyInput)
			if (keyInput === LETTER_A) editor.text += LETTER_A
		},
		render: () => [],
		invalidate: () => {},
	}
	return editor
}

interface GestureSession {
	editor: StubEditor
	press: (keyInput: string) => void
}

/** Attach the extension to a stub; clock ticks advance once per press. */
function session(
	initialText: string,
	ticks: readonly number[],
): GestureSession {
	const editor = stubEditor(initialText)
	// The extension reads the popup state off the editor instance itself.
	editor.isShowingAutocomplete = () => false
	attachDoubleEscapeClear(editor, fakeKeybindings(), injectedClock(ticks))
	return {
		editor,
		press: keyInput => editor.handleInput(keyInput),
	}
}

void test('fires on the second escape inside the window', () => {
	const pacer = new EscapePacer()
	assert.equal(pacer.registerEscape(1000), false)
	assert.equal(
		pacer.registerEscape(1000 + DOUBLE_ESCAPE_WINDOW_MS),
		true,
		'press at the last millisecond inside the window is a pair',
	)
})

void test('re-arms after firing, needing two fresh presses', () => {
	const pacer = new EscapePacer()
	pacer.registerEscape(0)
	pacer.registerEscape(10)
	// The pair fired, so the next press opens a new window instead of firing.
	assert.equal(pacer.registerEscape(500), false)
	assert.equal(pacer.registerEscape(700), true)
})

void test('drops the first press once the window elapsed', () => {
	const pacer = new EscapePacer()
	pacer.registerEscape(0)
	assert.equal(pacer.registerEscape(DOUBLE_ESCAPE_WINDOW_MS + 1), false)
	assert.equal(pacer.registerEscape(DOUBLE_ESCAPE_WINDOW_MS + 2), true)
})

void test('forgetting an open window makes the next press a first press', () => {
	const pacer = new EscapePacer()
	pacer.registerEscape(1000)
	pacer.reset()
	assert.equal(pacer.registerEscape(1100), false)
})

void test('second escape inside the window clears a non-empty prompt', () => {
	const gesture = session('draft message', [1000, 1030])
	gesture.press(ESCAPE)
	gesture.press(ESCAPE)
	assert.equal(gesture.editor.text, '')
	// Only the FIRST escape reached pi's editor; the pair itself was consumed.
	assert.deepEqual(gesture.editor.basePresses, [ESCAPE])
})

void test('escape pair on an empty prompt reaches pi twice (built-in action)', () => {
	const gesture = session('', [1000, 1030])
	gesture.press(ESCAPE)
	gesture.press(ESCAPE)
	assert.equal(gesture.editor.text, '')
	assert.deepEqual(gesture.editor.basePresses, [ESCAPE, ESCAPE])
})

void test('any other key breaks the gesture', () => {
	const gesture = session('keep me', [1000, 1005, 1010])
	gesture.press(ESCAPE)
	gesture.press(LETTER_A)
	gesture.press(ESCAPE)
	// The last escape opened a fresh window (the letter reset the first one).
	assert.equal(gesture.editor.text, 'keep mea')
	assert.deepEqual(gesture.editor.basePresses, [ESCAPE, LETTER_A, ESCAPE])
})

void test('presses just past the window are separate gestures', () => {
	const gesture = session('draft', [0, DOUBLE_ESCAPE_WINDOW_MS + 1])
	gesture.press(ESCAPE)
	gesture.press(ESCAPE)
	assert.equal(gesture.editor.text, 'draft')
	assert.deepEqual(gesture.editor.basePresses, [ESCAPE, ESCAPE])
})

void test('escape pair never clears while autocomplete is open', () => {
	const gesture = session('draft', [1000, 1030])
	gesture.editor.isShowingAutocomplete = () => true
	gesture.press(ESCAPE)
	gesture.press(ESCAPE)
	assert.equal(gesture.editor.text, 'draft')
	assert.deepEqual(gesture.editor.basePresses, [ESCAPE, ESCAPE])
})
