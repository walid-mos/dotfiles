/**
 * Input routing for the questionnaire: maps keyboard input onto state
 * transitions. Free-text editing routes to the embedded Editor (with cursor
 * escape at the buffer edges); option rows route to selection keys.
 */

import { Key, matchesKey } from '@earendil-works/pi-tui'

import type { Editor, KeybindingsManager } from '@earendil-works/pi-tui'
import type { Question } from './questionnaire-model.ts'
import type { QuestionnaireEffect } from './questionnaire-state.ts'
import type { QuestionnaireState } from './questionnaire-state.ts'

/** Actions the router requests from the component lifecycle. */
interface ConfigurationActions {
	refresh(): void
	applyEffects(effects: QuestionnaireEffect[]): void
}

export interface QuestionnaireInputDeps {
	state: QuestionnaireState
	editor: Editor
	keybindings: KeybindingsManager
	actions: ConfigurationActions
}

/** True when ↑ can leave the editor for the option above. */
function cursorOnFirstRow(editor: Editor): boolean {
	return editor.getCursor().line === 0
}

/** True when ↓ can leave the editor for the option below. */
function cursorOnLastRow(editor: Editor): boolean {
	const cursor = editor.getCursor()
	return cursor.line === editor.getLines().length - 1
}

export class QuestionnaireInputRouter {
	private readonly deps: QuestionnaireInputDeps

	constructor(deps: QuestionnaireInputDeps) {
		this.deps = deps
	}

	handleInput(input: string): void {
		const { state, actions } = this.deps
		if (matchesKey(input, Key.ctrl('g'))) {
			actions.applyEffects(state.requestChat())
			return
		}
		// Editor focused (cursor on "Type something." or open-ended question):
		// route everything to the always-visible editor, including digits.
		if (state.editorHasFocus()) {
			this.handleEditorKey(input)
			return
		}
		if (this.routeTabKey(input)) return
		if (this.routeSubmitKey(input)) return
		this.handleOptionKey(input)
	}

	/** Tab / Shift+Tab (and arrows) cycle through the questions and Submit tab. */
	private routeTabKey(input: string): boolean {
		const { state, actions } = this.deps
		if (!state.isMulti) return false
		const forward =
			matchesKey(input, Key.tab) || matchesKey(input, Key.right)
		const backward =
			matchesKey(input, Key.shift('tab')) || matchesKey(input, Key.left)
		if (!forward && !backward) return false
		const offset = forward ? 1 : -1
		state.enterTab((state.tab + offset + state.totalTabs) % state.totalTabs)
		actions.refresh()
		return true
	}

	private routeSubmitKey(input: string): boolean {
		const { state, actions } = this.deps
		if (!state.isOnSubmitTab()) return false
		if (matchesKey(input, Key.enter) && state.allAnswered())
			actions.applyEffects(['submit'])
		else if (matchesKey(input, Key.escape)) actions.applyEffects(['cancel'])
		return true
	}

	private handleEditorKey(input: string): void {
		const { state, editor, actions } = this.deps
		if (this.routeTabKey(input)) return
		this.routeEditorArrowKeys(input)
		if (matchesKey(input, Key.escape)) {
			actions.applyEffects(state.escape())
			return
		}
		editor.handleInput(input)
		actions.refresh()
	}

	/** ↑/↓ at the editor's buffer edges leave the editor for the neighbouring
	 * option row; inside the buffer they move the cursor. */
	private routeEditorArrowKeys(input: string): void {
		const { state, editor, actions } = this.deps
		const question = state.currentQuestion()
		if (
			question &&
			!state.isOpenEnded(question) &&
			matchesKey(input, Key.up) &&
			cursorOnFirstRow(editor)
		) {
			actions.applyEffects(state.moveCursor(-1))
			return
		}
		if (
			question &&
			matchesKey(input, Key.down) &&
			cursorOnLastRow(editor)
		) {
			actions.applyEffects(state.moveCursor(1))
		}
	}

	private handleOptionKey(input: string): void {
		const { state, actions } = this.deps
		if (this.hijackVerticalNavigation(input)) return
		const question = state.currentQuestion()
		if (!question) return
		if (this.routeOptionRowKeys(input, question)) return
		if (matchesKey(input, Key.escape)) actions.applyEffects(state.escape())
	}

	private hijackVerticalNavigation(input: string): boolean {
		const { state, actions, keybindings } = this.deps
		if (keybindings.matches(input, 'tui.select.up')) {
			actions.applyEffects(state.moveCursor(-1))
			return true
		}
		if (keybindings.matches(input, 'tui.select.down')) {
			actions.applyEffects(state.moveCursor(1))
			return true
		}
		return false
	}

	/** Number keys 1-9: instant select (single) or toggle (multi); Space toggles
	 * multi; Enter confirms the selected row. */
	private routeOptionRowKeys(input: string, question: Question): boolean {
		const { state, actions } = this.deps
		if (/^[1-9]$/.test(input)) {
			const optionIndex = Number.parseInt(input, 10) - 1
			if (optionIndex < state.currentOptions().length) {
				actions.applyEffects(
					question.multiSelect
						? state.toggleMultiOption(optionIndex)
						: state.selectOption(optionIndex),
				)
			}
			return true
		}
		if (question.multiSelect && matchesKey(input, Key.space)) {
			actions.applyEffects(state.toggleMultiOption(state.cursor))
			return true
		}
		if (matchesKey(input, Key.enter)) {
			actions.applyEffects(this.confirmSelectedRow(question))
			return true
		}
		return false
	}

	private confirmSelectedRow(question: Question): QuestionnaireEffect[] {
		const { state } = this.deps
		if (state.isChatAction()) return state.requestChat()
		if (question.multiSelect) return state.commitMultiSelection(question)
		return state.selectOption(state.cursor)
	}
}
