/** Questionnaire capture behavior: alias ingestion, dialog prune rules,
 * snapshot records for replay, and the strip keys' routing. The live dialog
 * drives a real pi editor and a tmpdir PNG fixture; assertions hold from the
 * same reference semantics the prompt wiring ships with. */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
	Editor,
	getKeybindings,
	ProcessTerminal,
	stripTerminalSequences,
	TuiMainScreen,
} from '@earendil-works/pi-tui'

import {
	answerReferenceTexts,
	QuestionnaireCaptures,
} from '../extensions/ask-user-question/questionnaire-captures.ts'
import { QuestionnaireInputController } from '../extensions/ask-user-question/questionnaire-input.ts'
import { parseAskResult } from '../extensions/ask-user-question/questionnaire-normalization.ts'
import { renderQuestionnaire } from '../extensions/ask-user-question/questionnaire-render.ts'
import { QuestionnaireState } from '../extensions/ask-user-question/questionnaire-state.ts'
import { renderResultLines } from '../extensions/ask-user-question/questionnaire-transcript.ts'

import { png } from './png-fixture.ts'

import type { TestContext } from 'node:test'
import type { Theme } from '@earendil-works/pi-coding-agent'
import type { StripInput } from '../extensions/ask-user-question/questionnaire-input.ts'
import type {
	AskResult,
	Question,
} from '../extensions/ask-user-question/questionnaire-model.ts'

const plain = (text: string): string => text

/** Identity theme: strip rows stay readable; only fg/bold surface is used. */
// oxlint-disable-next-line nextnode/no-type-assertion - Pi Theme is duck-typed through the strip surface
const stripTheme = {
	fg: (role: string, content: string) => `${role}/${content}`,
	bold: (content: string) => content,
} as Theme

function createEditor(): Editor {
	// Real editor surface (paste, cursor, callbacks); terminal IO never starts.
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

function openQuestion(id: string): Question {
	return {
		id,
		label: id.toUpperCase(),
		prompt: `Choose ${id}`,
		options: [],
		allowOther: true,
		multiSelect: false,
	}
}

function optionQuestion(id: string): Question {
	return {
		...openQuestion(id),
		prompt: `Pick ${id}`,
		options: [{ value: 'single-a', label: 'A' }],
	}
}

const KEY_BINDING_FIXTURE = {
	questions: [openQuestion('notes'), openQuestion('budget')],
}

interface DialogFixture {
	readonly state: QuestionnaireState
	readonly editor: Editor
	readonly captures: QuestionnaireCaptures
	readonly firstPath: string
	readonly spacedPath: string
}

function dialogFixture(
	context: TestContext,
	questions: readonly Question[] = KEY_BINDING_FIXTURE.questions,
): DialogFixture {
	const directory = mkdtempSync(join(tmpdir(), 'ask-captures-'))
	context.after(() => rmSync(directory, { recursive: true, force: true }))
	const firstPath = join(directory, 'skeleton.png')
	const spacedPath = join(directory, 'Screenshot 2026-09-09 at 20.04.21.png')
	for (const path of [firstPath, spacedPath]) {
		writeFileSync(
			path,
			Buffer.from(
				png(1, 1, () => [255, 0, 0, 255]),
				'base64',
			),
		)
	}
	const editor = createEditor()
	const captures = new QuestionnaireCaptures(directory)
	// Strip renders warm cold tiles through the preview worker: dispose it or
	// the worker thread keeps the test process alive.
	context.after(async () => captures.dispose())
	captures.bindRepaint(() => {})
	const state = new QuestionnaireState([...questions], editor)
	captures.attachDialogEditor(editor, getKeybindings(), () =>
		state.aliasReferenceTexts(),
	)
	return { state, editor, captures, firstPath, spacedPath }
}

const PASTE_START = '\u001b[200~'
const PASTE_END = '\u001b[201~'

void test('pasted screenshot paths become aliases with a live strip', t => {
	const { editor, captures, firstPath } = dialogFixture(t)

	editor.handleInput(`${PASTE_START}see ${firstPath} now${PASTE_END}`)

	assert.equal(editor.getText(), 'see [img:1] now')
	assert.ok(captures.isStripVisible)
	const lines = captures.stripLines(stripTheme, 40)
	// Cold tiles show their filename placeholder and the alias label.
	const visible = stripTerminalSequences(lines.join('\n'))
	assert.match(visible, /skeleton/)
})

void test('deleting the alias through the text drops its capture', t => {
	const { editor, captures, firstPath } = dialogFixture(t)

	editor.handleInput(`${PASTE_START}${firstPath}${PASTE_END}`)
	assert.ok(captures.isStripVisible)

	editor.setText('see nothing now')

	assert.equal(captures.isStripVisible, false)
	assert.equal(editor.getText(), 'see nothing now')
})

void test('an answer keeps its capture while later tabs clear the editor', t => {
	const { state, editor, captures, firstPath } = dialogFixture(t)
	const tileBase64 = png(1, 1, () => [255, 0, 0, 255])

	editor.setText(`look ${firstPath}`)
	// Mirror the dialog's sequencing: submit records the answer, then the
	// batch advances to the next tab, clearing the editor for its draft.
	assert.deepEqual(state.submitEditorText(editor.getText()), ['advance'])
	const target = state.advanceTarget()
	assert.equal(target, 1)
	state.enterTab(1)

	assert.equal(editor.getText(), '')
	assert.ok(captures.isStripVisible, 'the submitted answer cites [img:1]')

	const references = answerReferenceTexts(state.collectedAnswers())
	const [record] = captures.replayRecords(references)
	assert.equal(record?.alias, '[img:1]')
	assert.ok((record?.imageId ?? 0) > 0)
	assert.ok((record?.data.length ?? 0) > 0)

	const [image] = captures.modelAttachments(references)
	assert.equal(image?.type, 'image')
	assert.equal(image?.mimeType, 'image/png')
	// Without a settled preview the record keeps the full payload for the model.
	assert.equal(image?.data, tileBase64)
	// Warm-tile replay never invents a second capture for a plain answer.
	assert.equal(captures.replayRecords(['word sums']).length, 0)
})

void test('restored records number the next capture after their alias', t => {
	const { editor, captures, spacedPath } = dialogFixture(t)
	captures.restore([
		{
			alias: '[img:2]',
			mimeType: 'image/png',
			filePath: spacedPath,
			imageId: 77,
			data: 'dGlsZQ==',
		},
	])

	editor.handleInput(`${PASTE_START}${spacedPath}${PASTE_END}`)

	assert.ok(captures.isStripVisible)
	assert.ok(
		editor.getText().includes('[img:3]'),
		`numbering continues: ${editor.getText()}`,
	)
})

void test('the strip renders inside the live dialog frame', t => {
	const { state, editor, captures, firstPath } = dialogFixture(t)

	editor.setText(`see ${firstPath}`)

	const lines = renderQuestionnaire(state, editor, 40, width =>
		captures.stripLines(stripTheme, width),
	)
	const visible = stripTerminalSequences(lines.join('\n'))
	const stripRow = visible.indexOf('[img:1]')
	const questionRow = visible.indexOf('Choose notes')
	assert.ok(stripRow >= 0, `strip rendered inside the dialog: ${visible}`)
	assert.ok(questionRow > stripRow)
})

void test('result replay shows the snapshot strip above the custom answer', () => {
	const details: AskResult = {
		questions: [openQuestion('notes')],
		answers: [
			{
				kind: 'single',
				id: 'notes',
				value: 'use the skeleton',
				label: 'use [img:1]',
				wasCustom: true,
			},
		],
		cancelled: false,
		captures: [
			{
				alias: '[img:1]',
				mimeType: 'image/png',
				filePath: '/tmp/skeleton.png',
				imageId: 11,
				data: 'dGlsZQ==',
			},
		],
	}

	const lines = renderResultLines(details, 40, stripTheme)
	const visible = stripTerminalSequences(lines.join('\n'))

	const stripRow = visible.indexOf('[img:1]')
	const answerRow = visible.indexOf('use [img:1]')
	assert.ok(stripRow >= 0, `strip replayed: ${visible}`)
	assert.ok(answerRow > stripRow)
})

void test('captures survive the schema across the session round trip', () => {
	const details = {
		questions: [openQuestion('notes')],
		answers: [],
		cancelled: false,
		chat: {
			question: openQuestion('notes'),
			initialState: {
				answers: [],
				drafts: { notes: 'look [img:2]' },
				captures: [
					{
						alias: '[img:2]',
						mimeType: 'image/png',
						filePath: '/tmp/shot.png',
						imageId: 12,
						data: 'dGlsZQ==',
					},
				],
			},
		},
	}

	const parsed = parseAskResult(details)
	assert.ok(parsed)
	assert.equal(parsed.chat?.initialState.drafts?.notes, 'look [img:2]')
	assert.equal(parsed.chat?.initialState.captures?.[0]?.alias, '[img:2]')
})

void test('strip keys route before navigation, paste only while typing', t => {
	const { state, editor } = dialogFixture(t, [optionQuestion('pick')])
	const pastes: number[] = []
	const scrolls: (-1 | 1)[] = []
	const strip: StripInput = {
		pasteImage: keyInput => {
			if (keyInput !== '\u0016') return false
			pastes.push(pastes.length + 1)
			return true
		},
		canScrollStrip: () => true,
		scrollStrip: delta => {
			scrolls.push(delta)
		},
	}
	const controller = new QuestionnaireInputController({
		state,
		editor,
		keybindings: getKeybindings(),
		switchTab: () => {},
		applyEffects: () => {},
		captures: strip,
	})

	// The editor holds focus on the custom answer row: Ctrl+V is the paste
	// key there (the option row itself keeps it inert).
	assert.deepEqual(state.selectOption(1), ['render'])
	assert.equal(state.editorHasFocus(), true)
	controller.handleInput('\u0016')
	assert.deepEqual(pastes, [1])
	assert.deepEqual(scrolls, [])

	// Ctrl+Shift+Left/Right scroll the strip, before arrow-key navigation.
	controller.handleInput('\u001b[1;6D')
	controller.handleInput('\u001b[1;6C')
	assert.deepEqual(scrolls, [-1, 1])

	// On the option list (editor blurred) the paste key falls through.
	assert.deepEqual(state.selectOption(0), ['advance'])
	assert.equal(state.editorHasFocus(), false)
	controller.handleInput('\u0016')
	assert.deepEqual(pastes, [1])
	assert.equal(editor.getText(), '')
})
