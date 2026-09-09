import { Key, matchesKey } from '@earendil-works/pi-tui'

import type { Editor } from '@earendil-works/pi-tui'
import type { Question } from './questionnaire-model.ts'
import type { QuestionnaireEffect } from './questionnaire-navigation-state.ts'
import type { QuestionnaireState } from './questionnaire-state.ts'

type SelectionAction =
	| 'tui.select.up'
	| 'tui.select.down'
	| 'tui.select.confirm'
	| 'tui.select.cancel'

export interface SelectionKeybindings {
	matches(data: string, action: SelectionAction): boolean
}

type ApplyEffects = (effects: QuestionnaireEffect[]) => void
type SwitchTab = (delta: -1 | 1) => void

/** Live-dialog dependencies of the keyboard router. */
export interface QuestionnaireInputTargets {
	readonly state: QuestionnaireState
	readonly editor: Editor
	readonly keybindings: SelectionKeybindings
	readonly switchTab: SwitchTab
	readonly applyEffects: ApplyEffects
}

/** Editor cursor position, or undefined when the editor does not have focus. */
function editorCursor(
	state: QuestionnaireState,
	editor: Editor,
): { line: number; col: number } | undefined {
	if (!state.editorHasFocus()) return undefined
	return editor.getCursor()
}

function cursorOnFirstRow(state: QuestionnaireState, editor: Editor): boolean {
	return editorCursor(state, editor)?.line === 0
}

function cursorOnLastRow(state: QuestionnaireState, editor: Editor): boolean {
	const cursor = editorCursor(state, editor)
	if (!cursor) return false
	return cursor.line === editor.getLines().length - 1
}

function cursorAtBufferStart(editor: Editor): boolean {
	const cursor = editor.getCursor()
	return cursor.line === 0 && cursor.col === 0
}

function cursorAtBufferEnd(editor: Editor): boolean {
	const cursor = editor.getCursor()
	const lines = editor.getLines()
	const lastLine = lines.at(-1)
	if (!lastLine) return false
	return cursor.line === lines.length - 1 && cursor.col >= lastLine.length
}

/** Route keyboard input into questionnaire state transitions. */
export class QuestionnaireInputController {
	private readonly state: QuestionnaireState
	private readonly editor: Editor
	private readonly keybindings: SelectionKeybindings
	private readonly switchTab: SwitchTab
	private readonly applyEffects: ApplyEffects

	constructor(targets: QuestionnaireInputTargets) {
		this.state = targets.state
		this.editor = targets.editor
		this.keybindings = targets.keybindings
		this.switchTab = targets.switchTab
		this.applyEffects = targets.applyEffects
	}

	handleInput(keystrokes: string): void {
		if (matchesKey(keystrokes, Key.ctrl('g'))) {
			this.applyEffects(this.state.requestChat())
			return
		}
		if (this.state.editorHasFocus()) {
			this.handleEditorKey(keystrokes)
			return
		}
		if (this.handleTabKey(keystrokes)) return
		if (this.handleSubmitTabKey(keystrokes)) return
		this.handleOptionKey(keystrokes)
	}

	private handleEditorKey(keystrokes: string): void {
		if (this.handleEditorTabKey(keystrokes)) return
		if (this.handleEditorVerticalKey(keystrokes)) return
		if (this.keybindings.matches(keystrokes, 'tui.select.cancel')) {
			this.applyEffects(this.state.escape())
			return
		}
		this.editor.handleInput(keystrokes)
		this.applyEffects(['render'])
	}

	private handleEditorTabKey(keystrokes: string): boolean {
		if (this.state.isMulti) {
			if (matchesKey(keystrokes, Key.tab)) {
				this.switchTab(1)
				return true
			}
			if (matchesKey(keystrokes, Key.shift('tab'))) {
				this.switchTab(-1)
				return true
			}
		}
		if (!this.state.canNavigateTabsFromInputEdges()) return false
		if (
			matchesKey(keystrokes, Key.right) &&
			cursorAtBufferEnd(this.editor)
		) {
			this.switchTab(1)
			return true
		}
		if (
			matchesKey(keystrokes, Key.left) &&
			cursorAtBufferStart(this.editor)
		) {
			this.switchTab(-1)
			return true
		}
		return false
	}

	private handleEditorVerticalKey(keystrokes: string): boolean {
		const question = this.state.currentQuestion()
		if (question && matchesKey(keystrokes, Key.up)) {
			if (
				!this.state.isOpenEnded(question) &&
				cursorOnFirstRow(this.state, this.editor)
			) {
				this.applyEffects(this.state.moveCursor(-1))
				return true
			}
			return false
		}
		if (
			question &&
			matchesKey(keystrokes, Key.down) &&
			cursorOnLastRow(this.state, this.editor)
		) {
			this.applyEffects(this.state.moveCursor(1))
			return true
		}
		return false
	}

	private handleTabKey(keystrokes: string): boolean {
		if (!this.state.isMulti) return false
		if (
			matchesKey(keystrokes, Key.tab) ||
			matchesKey(keystrokes, Key.right)
		) {
			this.switchTab(1)
			return true
		}
		if (
			matchesKey(keystrokes, Key.shift('tab')) ||
			matchesKey(keystrokes, Key.left)
		) {
			this.switchTab(-1)
			return true
		}
		return false
	}

	private handleSubmitTabKey(keystrokes: string): boolean {
		if (!this.state.isOnSubmitTab()) return false
		if (
			this.keybindings.matches(keystrokes, 'tui.select.confirm') &&
			this.state.allAnswered()
		) {
			this.applyEffects(['submit'])
		} else if (this.keybindings.matches(keystrokes, 'tui.select.cancel')) {
			this.applyEffects(['cancel'])
		}
		return true
	}

	private handleOptionKey(keystrokes: string): void {
		if (this.keybindings.matches(keystrokes, 'tui.select.up')) {
			this.applyEffects(this.state.moveCursor(-1))
			return
		}
		if (this.keybindings.matches(keystrokes, 'tui.select.down')) {
			this.applyEffects(this.state.moveCursor(1))
			return
		}
		const question = this.state.currentQuestion()
		if (!question) return
		if (this.handleDigitKey(keystrokes, question)) return
		this.handleSelectKey(keystrokes, question)
	}

	private handleDigitKey(keystrokes: string, question: Question): boolean {
		if (!/^[1-9]$/.test(keystrokes)) return false
		const index = Number.parseInt(keystrokes, 10) - 1
		if (index < this.state.currentOptions().length) {
			this.applyEffects(
				question.multiSelect
					? this.state.toggleMultiOption(index)
					: this.state.selectOption(index),
			)
		}
		return true
	}

	private handleSelectKey(keystrokes: string, question: Question): boolean {
		if (question.multiSelect && matchesKey(keystrokes, Key.space)) {
			this.applyEffects(this.state.toggleMultiOption(this.state.cursor))
			return true
		}
		if (this.keybindings.matches(keystrokes, 'tui.select.confirm')) {
			this.applyEffects(this.confirmEffects(question))
			return true
		}
		if (this.keybindings.matches(keystrokes, 'tui.select.cancel')) {
			this.applyEffects(this.state.escape())
			return true
		}
		return false
	}

	private confirmEffects(question: Question): QuestionnaireEffect[] {
		if (this.state.isChatAction()) return this.state.requestChat()
		if (question.multiSelect)
			return this.state.commitMultiSelection(question)
		return this.state.selectOption(this.state.cursor)
	}
}
