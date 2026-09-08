/**
 * Regression tests for the ask-user-question questionnaire: the model-boundary
 * normalization (label doubles as the option value), the state machine
 * (selection flows, multi-select commits, snapshot capture/restore) and the
 * basic renderer output. The typebox schema itself is validated at runtime by
 * pi's loader, so it is deliberately not imported here.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
	captureSnapshot,
	QuestionnaireSelections,
} from '../extensions/ask-user-question/questionnaire-answers.ts'
import { normalizeQuestions } from '../extensions/ask-user-question/questionnaire-model.ts'
import { renderQuestionnaire } from '../extensions/ask-user-question/questionnaire-render.ts'
import { QuestionnaireState } from '../extensions/ask-user-question/questionnaire-state.ts'

import type { Question } from '../extensions/ask-user-question/questionnaire-model.ts'
import type {
	QuestionnairePalette,
	QuestionnaireView,
	RenderEditor,
} from '../extensions/ask-user-question/questionnaire-render-kit.ts'
import type { EditorPort } from '../extensions/ask-user-question/questionnaire-state.ts'

const SINGLE: Question = {
	id: 'mode',
	label: 'Mode',
	prompt: 'Which mode?',
	options: [{ label: 'Fast' }, { label: 'Safe', recommended: true }],
	allowOther: true,
	multiSelect: false,
}

const OPEN: Question = {
	id: 'notes',
	label: 'Notes',
	prompt: 'Notes?',
	options: [],
	allowOther: true,
	multiSelect: false,
}

const MULTI: Question = {
	id: 'stack',
	label: 'Stack',
	prompt: 'Which stack?',
	options: [{ label: 'Node' }, { label: 'Deno' }],
	allowOther: true,
	multiSelect: true,
}

/** Minimal editor double for the state machine; its buffer stands in for the
 * shared pi-tui editor (which self-clears before onSubmit). */
class FakeEditor implements EditorPort {
	text = ''
	getText(): string {
		return this.text
	}
	setText(text: string): void {
		this.text = text
	}
}

/** Editor double narrowed to the renderer's surface. */
class FakeRenderEditor implements RenderEditor {
	getText(): string {
		return 'typed text'
	}
	render(): string[] {
		return ['12345', '', '']
	}
}

function renderView(
	state: QuestionnaireState,
	questions: readonly Question[],
	editor: RenderEditor,
): QuestionnaireView {
	return { state, questions, editor, theme: plainTheme(), width: 40 }
}

function plainTheme(): QuestionnairePalette {
	return {
		fg: (_color, text) => text,
		bold: text => text,
	}
}

// --- Boundary normalization ---

void test('options keep their label; no separate value field exists', () => {
	const [question] = normalizeQuestions([
		{
			prompt: 'Which auto-text behaviors should the bootstrap force OFF?',
			options: [
				{
					label: 'Spelling auto-correction',
					description: 'NSAutomaticSpellingEnabled',
				},
			],
		},
	])
	assert.deepEqual(question, {
		id: 'q1',
		label: 'Q1',
		prompt: 'Which auto-text behaviors should the bootstrap force OFF?',
		options: [
			{
				label: 'Spelling auto-correction',
				description: 'NSAutomaticSpellingEnabled',
			},
		],
		allowOther: true,
		multiSelect: false,
	})
})

void test('question defaults: explicit id and label win, positional otherwise', () => {
	const [question] = normalizeQuestions([
		{
			id: 'scope',
			label: 'Scope',
			multiSelect: true,
			prompt: 'Which stack?',
			options: [{ label: 'Spelling' }, { label: 'Capitalization' }],
		},
	])
	assert.deepEqual(question, {
		id: 'scope',
		label: 'Scope',
		prompt: 'Which stack?',
		options: [{ label: 'Spelling' }, { label: 'Capitalization' }],
		allowOther: true,
		multiSelect: true,
	})
})

// --- State machine ---

void test('recommended option is preselected; single question has no tab bar', () => {
	const state = new QuestionnaireState([SINGLE], new FakeEditor())
	assert.equal(state.isMulti, false)
	assert.equal(state.totalTabs, 2) // 1 question + Submit
	assert.equal(state.cursor, 1) // recommended option preselected
})

void test('single-select commit returns advance and records a 1-based answer', () => {
	const state = new QuestionnaireState([SINGLE], new FakeEditor())
	assert.deepEqual(state.selectOption(1), ['advance'])
	assert.deepEqual(state.answerFor('mode'), {
		kind: 'single',
		id: 'mode',
		label: 'Safe',
		wasCustom: false,
		index: 2,
	})
	assert.equal(state.advanceTarget(), 'submit')
})

void test('open-ended questions submit typed text as a custom answer', () => {
	const state = new QuestionnaireState([OPEN], new FakeEditor())
	assert.equal(state.editorHasFocus(), true)
	assert.deepEqual(state.submitEditorText('  my answer  '), ['advance'])
	assert.deepEqual(state.answerFor('notes'), {
		kind: 'single',
		id: 'notes',
		label: 'my answer',
		wasCustom: true,
	})
})

void test('multiSelect combines toggled options with the submitted draft', () => {
	const state = new QuestionnaireState([MULTI], new FakeEditor())
	state.toggleMultiOption(0)
	assert.deepEqual(state.submitEditorText(' extra idea '), ['advance'])
	assert.deepEqual(state.answerFor('stack'), {
		kind: 'multi',
		id: 'stack',
		label: 'Node, extra idea',
		wasCustom: false,
		labels: ['Node', 'extra idea'],
		customText: 'extra idea',
	})
})

void test('empty multiSelect commit with nothing selected is a no-effect', () => {
	const state = new QuestionnaireState([MULTI], new FakeEditor())
	assert.deepEqual(state.commitMultiSelection(MULTI), [])
})

void test('escape returns to the first option from the editor, cancels elsewhere', () => {
	const state = new QuestionnaireState([SINGLE], new FakeEditor())
	state.moveCursor(1) // land on the "Type something." row
	assert.equal(state.cursor, 2) // options 0, 1 then the "Type something." row at 2
	assert.equal(state.editorHasFocus(), true)
	assert.deepEqual(state.escape(), ['render'])
	assert.equal(state.cursor, 0)
	assert.deepEqual(state.escape(), ['cancel'])
})

void test('committed free text survives navigating to the next tab and back', () => {
	const questions = [MULTI, OPEN]
	const editor = new FakeEditor()
	const state = new QuestionnaireState(questions, editor)
	state.toggleMultiOption(0)
	// Mirror pi-tui: the editor clears its own buffer BEFORE firing onSubmit.
	editor.setText('')
	assert.deepEqual(state.submitEditorText('Ah gros probleme'), ['advance']) // auto-advance
	state.enterTab(0) // go back
	assert.equal(editor.getText(), 'Ah gros probleme')
	assert.equal(state.isChecked(MULTI, 0, false), true)
})

void test('single custom answer draft survives leaving the question', () => {
	const editor = new FakeEditor()
	const state = new QuestionnaireState([SINGLE, OPEN], editor)
	state.moveCursor(1)
	editor.setText('') // pi-tui clears before onSubmit
	assert.deepEqual(state.submitEditorText('typed answer'), ['advance'])
	state.enterTab(1)
	state.enterTab(0)
	assert.equal(editor.getText(), 'typed answer')
})

void test('in-flight typing survives navigation; erased typing stays erased', () => {
	const editor = new FakeEditor()
	const state = new QuestionnaireState([SINGLE, OPEN], editor)
	state.moveCursor(1)
	editor.setText('in flight')
	state.enterTab(1)
	state.enterTab(0)
	assert.equal(editor.getText(), 'in flight')

	editor.setText('') // user erased it, then left
	state.enterTab(1)
	state.enterTab(0)
	assert.equal(editor.getText(), '')
})

void test('revisiting an answered multiSelect puts the cursor on a checked option', () => {
	const questions = [MULTI, OPEN]
	const editor = new FakeEditor()
	const state = new QuestionnaireState(questions, editor)
	state.enterTab(0)
	state.toggleMultiOption(0)
	assert.deepEqual(state.submitEditorText(''), ['advance']) // commit picks only
	state.enterTab(0) // go back: the checked option keeps the cursor
	assert.equal(state.cursor, 0)
})

void test('revisiting an answered single-select puts the cursor on the answered option, not the recommended one', () => {
	const questions = [SINGLE, OPEN]
	const state = new QuestionnaireState(questions, new FakeEditor())
	state.moveCursor(-1) // pick the FIRST option ("Fast"), not the recommended
	assert.deepEqual(state.selectOption(0), ['advance'])
	state.enterTab(0)
	assert.equal(state.cursor, 0)
})

void test('revisiting a custom single answer keeps the other row preselected', () => {
	const editor = new FakeEditor()
	const state = new QuestionnaireState([SINGLE, OPEN], editor)
	state.moveCursor(1)
	editor.setText('')
	assert.deepEqual(state.submitEditorText('custom answer'), ['advance'])
	state.enterTab(0)
	assert.equal(state.cursor, 2) // row 2 = the "Type something." row (2 options)
})

void test('snapshot captures answers and restores them into a resumed state', () => {
	const editor = new FakeEditor()
	editor.setText('typed draft')
	const state = new QuestionnaireState([SINGLE], editor)
	state.submitEditorText('typed draft')
	const resumed = new QuestionnaireState(
		[SINGLE],
		new FakeEditor(),
		state.snapshot(),
	)
	assert.equal(resumed.answerFor('mode')?.label, 'typed draft')
})

void test('restore drops answers incompatible with the current questions', () => {
	const selections = new QuestionnaireSelections([SINGLE], {
		answers: [
			{
				kind: 'single',
				id: 'mode',
				label: 'Gone',
				wasCustom: false,
			},
		],
		drafts: {},
	})
	assert.equal(selections.answerFor('mode'), undefined)
})

void test('captureSnapshot serializes answers and drafts round-trip', () => {
	const selections = new QuestionnaireSelections([SINGLE])
	selections.answerSingleOption(SINGLE, { label: 'Safe' }, 2)
	selections.setDraft('mode', 'typed outside options')
	const snapshot = captureSnapshot(selections.answers, selections.drafts)
	const restored = new QuestionnaireSelections([SINGLE], snapshot)
	assert.equal(restored.answerFor('mode')?.label, 'Safe')
	assert.equal(restored.draftOf('mode'), 'typed outside options')
})

// --- Renderer (basic style) ---

void test('option rows render labels, numbering and the other row', () => {
	const state = new QuestionnaireState([SINGLE], new FakeEditor())
	const flat = renderQuestionnaire(
		renderView(state, [SINGLE], new FakeRenderEditor()),
	).join('\n')
	assert.match(flat, /1\. Fast/)
	assert.match(flat, /2\. Safe/)
	assert.match(flat, /Type something\./)
})

void test('renderer draws a basic frame: prompt, answer editor, chat row, help', () => {
	const state = new QuestionnaireState([OPEN], new FakeEditor())
	const flat = renderQuestionnaire(
		renderView(state, [OPEN], new FakeRenderEditor()),
	).join('\n')
	assert.match(flat, /Notes\?/)
	assert.match(flat, /Your answer:/)
	assert.match(flat, /Chat about this \(Ctrl\+G\)/)
	assert.match(flat, /Type your answer [\s\S]* Esc cancel/)
	assert.ok(
		!flat.includes('─'),
		'no decorative border rules in the basic style',
	)
	assert.ok(!flat.includes('■'), 'no tab boxes in the basic style')
})

void test('submit screen lists answers and warns on unfinished questions', () => {
	const questions = [SINGLE, MULTI]
	const state = new QuestionnaireState(questions, new FakeEditor())
	state.enterTab(questions.length) // jump to the Submit tab
	const flat = renderQuestionnaire(
		renderView(state, questions, new FakeRenderEditor()),
	).join('\n')
	assert.match(flat, /Unanswered/)
})
