/**
 * Pure navigation/selection state machine for the questionnaire.
 *
 * Navigation stays here (current tab, cursor position, tab transitions,
 * editor focus); the answer maps live in QuestionnaireSelections
 * (questionnaire-answers.ts). No TUI dependency: the editor text is mirrored
 * via a small adapter, and transitions that end the flow surface as
 * QuestionnaireEffect for the caller (the component) to apply.
 */

import { QuestionnaireSelections } from './questionnaire-answers.ts'
import { UI_TEXT } from './questionnaire-model.ts'

import type {
	Answer,
	Question,
	QuestionnaireChatRequest,
	QuestionnaireSnapshot,
	RenderOption,
} from './questionnaire-model.ts'

/** Editor operations the state machine needs - implemented by the TUI editor. */
export interface EditorPort {
	getText(): string
	setText(text: string): void
}

/** Side effects the caller must apply after a transition. */
export type QuestionnaireEffect =
	| 'render'
	| 'advance'
	| 'submit'
	| 'cancel'
	| 'chat'

const NO_EFFECT: QuestionnaireEffect[] = []
const RENDER: QuestionnaireEffect[] = ['render']

export class QuestionnaireState {
	readonly isMulti: boolean
	readonly totalTabs: number

	private currentTab = 0
	private optionIndex = 0
	private readonly questions: readonly Question[]
	private readonly editor: EditorPort
	private readonly selections: QuestionnaireSelections

	constructor(
		questions: readonly Question[],
		editor: EditorPort,
		snapshot?: QuestionnaireSnapshot,
	) {
		this.questions = questions
		this.editor = editor
		this.isMulti = questions.length > 1
		this.totalTabs = questions.length + 1 // questions + Submit
		this.selections = new QuestionnaireSelections(questions, snapshot)
		const initialTab = this.firstUnansweredTab()
		this.currentTab = initialTab
		this.enterTab(initialTab)
	}

	// --- Read-side queries (used by the renderer) ---

	get tab(): number {
		return this.currentTab
	}

	get cursor(): number {
		return this.optionIndex
	}

	currentQuestion(): Question | undefined {
		return this.questions[this.currentTab]
	}

	isOnSubmitTab(): boolean {
		return this.currentTab === this.questions.length
	}

	isOpenEnded(question: Question): boolean {
		return !question.options.length
	}

	/** Row index of the synthetic chat affordance relative to the option list. */
	chatActionIndex(): number {
		const question = this.currentQuestion()
		const isOptionList = question && !this.isOpenEnded(question)
		return isOptionList ? this.currentOptions().length : 0
	}

	isChatAction(): boolean {
		const question = this.currentQuestion()
		return Boolean(question && this.optionIndex === this.chatActionIndex())
	}

	currentOptions(): RenderOption[] {
		const question = this.currentQuestion()
		if (!question || this.isOnSubmitTab()) return []
		const options: RenderOption[] = [...question.options]
		if (question.allowOther) {
			options.push({ label: UI_TEXT.otherOptionLabel, isOther: true })
		}
		return options
	}

	typedText(): string {
		return this.editor.getText().trim()
	}

	/** Compact single-line preview of the typed text, for static rows. */
	typedPreview(maxLength: number): string {
		const flat = this.editor.getText().replace(/\s+/g, ' ').trim()
		if (flat.length <= maxLength) return flat
		return `${flat.slice(0, maxLength - 1)}…`
	}

	isChecked(question: Question, index: number, isOther: boolean): boolean {
		return this.selections.isChecked(question, index, {
			isOther,
			hasTypedText: this.typedText().length > 0,
		})
	}

	allAnswered(): boolean {
		return this.selections.allAnswered(this.questions)
	}

	unansweredLabels(): string[] {
		return this.selections.unansweredLabels(this.questions)
	}

	answerFor(questionId: string): Answer | undefined {
		return this.selections.answerFor(questionId)
	}

	collectedAnswers(): Answer[] {
		return this.selections.collectedAnswers()
	}

	/** Serialize the current state (including the pending draft) for a chat pause. */
	snapshot(): QuestionnaireSnapshot {
		const question = this.currentQuestion()
		if (question)
			this.selections.syncDraftOnLeave(question.id, this.typedText())
		return this.selections.captureSnapshot()
	}

	chatRequest(): QuestionnaireChatRequest | undefined {
		const question = this.currentQuestion()
		if (!question || this.isOnSubmitTab()) return undefined
		return { question, snapshot: this.snapshot() }
	}

	/** The editor is focused whenever the cursor sits on the "Type something." row
	 * (or always for open-ended questions) - no separate input mode. */
	editorHasFocus(): boolean {
		const question = this.currentQuestion()
		const outsideList =
			!question || this.isOnSubmitTab() || this.isChatAction()
		if (outsideList) return false
		return (
			this.isOpenEnded(question) ||
			(question.allowOther &&
				this.currentOptions()[this.optionIndex]?.isOther === true)
		)
	}

	// --- Transitions ---

	/** Switch tab: preserve the free-text draft, restore the target tab's draft,
	 * and preselect the recommended option (or the "Type something." row when a
	 * custom draft exists). */
	enterTab(index: number): void {
		const previous = this.currentQuestion()
		if (previous && this.currentTab !== index) {
			this.selections.syncDraftOnLeave(previous.id, this.typedText())
		}
		this.currentTab = index
		const question = this.currentQuestion()
		if (!question || this.isOnSubmitTab()) {
			this.editor.setText('')
			return
		}
		const draft =
			this.isOpenEnded(question) || question.allowOther
				? this.selections.draftOf(question.id)
				: ''
		this.editor.setText(draft ?? '')
		this.optionIndex = this.isOpenEnded(question)
			? -1
			: this.initialOptionIndex(question)
	}

	moveCursor(delta: -1 | 1): QuestionnaireEffect[] {
		const question = this.currentQuestion()
		const minIndex = question && this.isOpenEnded(question) ? -1 : 0
		const maxIndex = question
			? this.chatActionIndex()
			: Math.max(0, this.currentOptions().length - 1)
		const next = Math.min(
			Math.max(minIndex, this.optionIndex + delta),
			maxIndex,
		)
		if (next === this.optionIndex) return NO_EFFECT
		this.optionIndex = next
		return RENDER
	}

	/** Enter inside the free-text editor. The submitted value must be passed in:
	 * the pi-tui Editor clears its buffer BEFORE calling onSubmit, so reading
	 * getText() at this point would always return "". */
	submitEditorText(submittedValue: string): QuestionnaireEffect[] {
		const question = this.currentQuestion()
		if (!question) return NO_EFFECT
		const text = submittedValue.trim()

		if (this.isOpenEnded(question)) {
			this.selections.answerOpenEnded(question, text)
			return ['advance']
		}
		if (question.multiSelect) {
			return this.finalizeMultiWithDraft(question, text)
		}
		if (!text) {
			this.selections.setDraft(question.id, undefined) // nothing typed: row stays static
			return RENDER
		}
		this.selections.answerCustomText(question, text)
		return ['advance']
	}

	/** Enter on an option row (single-select) - the "Type something." row is
	 * unreachable here: it has editor focus, its Enter goes through submitEditorText. */
	selectOption(index: number): QuestionnaireEffect[] {
		const question = this.currentQuestion()
		if (!question) return NO_EFFECT
		if (!this.isOpenEnded(question) && index === this.chatActionIndex())
			return this.requestChat()
		const option = this.currentOptions()[index]
		if (!option) return NO_EFFECT
		this.optionIndex = index
		this.selections.answerSingleOption(question, option, index + 1)
		return ['advance']
	}

	/** Space / digit in multiSelect mode - the "Type something." row is unreachable
	 * here: it has editor focus, so Space goes to the editor as a literal space. */
	toggleMultiOption(index: number): QuestionnaireEffect[] {
		const question = this.currentQuestion()
		if (!question || index >= this.currentOptions().length) return NO_EFFECT
		this.selections.toggleMulti(question.id, index)
		return RENDER
	}

	/** Enter in multiSelect mode: confirm checked options plus the typed text. */
	commitMultiSelection(question: Question): QuestionnaireEffect[] {
		const answer = this.selections.commitMulti(
			question,
			this.currentOptions(),
		)
		return answer ? ['advance'] : NO_EFFECT
	}

	/** Esc behavior depends on context: editor with options -> back to the first
	 * option; anywhere else -> cancel the whole flow. */
	escape(): QuestionnaireEffect[] {
		const question = this.currentQuestion()
		if (this.editorHasFocus() && question && !this.isOpenEnded(question)) {
			this.optionIndex = 0
			return RENDER
		}
		return ['cancel']
	}

	/** Pause the questionnaire so the caller can open a chat for this question. */
	requestChat(): QuestionnaireEffect[] {
		return this.chatRequest() ? ['chat'] : NO_EFFECT
	}

	/** Where to go after an answer: next question, the Submit tab, or done. */
	advanceTarget(): 'submit' | number {
		if (!this.isMulti) return 'submit'
		if (this.currentTab < this.questions.length - 1)
			return this.currentTab + 1
		return this.questions.length // Submit tab
	}

	private finalizeMultiWithDraft(
		question: Question,
		submittedText: string,
	): QuestionnaireEffect[] {
		// Save the submitted text (not typedText(): the Editor already cleared
		// its buffer before onSubmit fired).
		this.selections.setDraft(question.id, submittedText || undefined)
		const answer = this.selections.commitMulti(
			question,
			this.currentOptions(),
		)
		return answer ? ['advance'] : NO_EFFECT
	}

	private firstUnansweredTab(): number {
		const index = this.questions.findIndex(
			question => !this.selections.hasAnswer(question.id),
		)
		return index >= 0 ? index : this.questions.length
	}

	/** Where the cursor lands on entry, derived from the answer state. */
	private initialOptionIndex(question: Question): number {
		return this.selections.entryCursor(question, this.currentOptions())
	}
}
