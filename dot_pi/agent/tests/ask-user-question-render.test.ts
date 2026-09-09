import assert from 'node:assert/strict'
import test from 'node:test'

import {
	Editor,
	ProcessTerminal,
	stripTerminalSequences,
	TuiMainScreen,
	visibleWidth,
} from '@earendil-works/pi-tui'

import { normalizeQuestions } from '../extensions/ask-user-question/questionnaire-normalization.ts'
import { renderQuestionnaire } from '../extensions/ask-user-question/questionnaire-render.ts'
import { QuestionnaireState } from '../extensions/ask-user-question/questionnaire-state.ts'

const plain = (text: string): string => text

function createEditor(): Editor {
	// Real editor and compositor; the terminal is never started (no IO).
	return new Editor(
		new TuiMainScreen(new ProcessTerminal()),
		{
			borderColor: plain,
			selectList: {
				selectedPrefix: plain,
				selectedText: plain,
				description: plain,
				scrollInfo: plain,
				noMatch: plain,
			},
		},
		{ paddingX: 0 },
	)
}

function openQuestion(): { state: QuestionnaireState; editor: Editor } {
	const editor = createEditor()
	const state = new QuestionnaireState(
		normalizeQuestions([{ id: 'notes', prompt: 'Notes?' }]),
		editor,
	)
	return { state, editor }
}

void test('open-ended prompt, placeholder and multiline answer share an inset', () => {
	const { state, editor } = openQuestion()
	const empty = renderQuestionnaire(state, editor, 40).map(
		stripTerminalSequences,
	)
	assert.match(empty.join('\n'), /│  Notes\?/u)
	assert.match(empty.join('\n'), /│  Type something/u)
	editor.setText('First line\nSecond line')
	const typed = renderQuestionnaire(state, editor, 40).map(
		stripTerminalSequences,
	)
	assert.match(typed.join('\n'), /│  First line/u)
	assert.match(typed.join('\n'), /│  Second line/u)
})

void test('open-ended down navigation has a visible chat target and returns to editing', () => {
	const { state, editor } = openQuestion()
	state.moveCursor(1)
	assert.equal(state.isChatAction(), true)
	assert.equal(state.editorHasFocus(), false)
	assert.match(
		renderQuestionnaire(state, editor, 60)
			.map(stripTerminalSequences)
			.join('\n'),
		/◉ Chat about this/u,
	)
	state.moveCursor(-1)
	assert.equal(state.editorHasFocus(), true)
})

void test('custom drafts stay visible without rendering an editor on another option', () => {
	const editor = createEditor()
	const state = new QuestionnaireState(
		normalizeQuestions([
			{ id: 'pick', prompt: 'Pick?', options: [{ label: 'First' }] },
		]),
		editor,
	)
	state.selectOption(1)
	editor.setText('Draft answer')
	state.moveCursor(-1)
	assert.equal(state.editorHasFocus(), false)
	assert.match(
		renderQuestionnaire(state, editor, 60)
			.map(stripTerminalSequences)
			.join('\n'),
		/Draft answer/u,
	)
})

void test('live editor rendering stays inside narrow and invalid viewport widths', () => {
	const { state, editor } = openQuestion()
	editor.setText('e\u0301 界 long answer text')
	for (const width of [0, 1, 2, 4, 8, 16, 40]) {
		const lines = renderQuestionnaire(state, editor, width)
		assert.ok(
			lines.every(line => visibleWidth(line) <= width),
			`overflow at ${width}`,
		)
	}
	assert.deepEqual(renderQuestionnaire(state, editor, Number.NaN), [])
})
