/**
 * The interactive questionnaire TUI component, run through ctx.ui.custom().
 * Thin wiring: keyboard input -> QuestionnaireState transitions -> effects
 * (render/advance/submit/cancel) applied against the TUI; rendering itself
 * lives in questionnaire-render.ts.
 */

import { Editor } from '@earendil-works/pi-tui'

import { uiTheme } from '../ui/design-system/theme.ts'

import { answerReferenceTexts } from './questionnaire-captures.ts'
import { QuestionnaireInputController } from './questionnaire-input.ts'
import { renderQuestionnaire } from './questionnaire-render.ts'
import { QuestionnaireState } from './questionnaire-state.ts'

import type { Theme } from '@earendil-works/pi-coding-agent'
import type {
	Component,
	EditorTheme,
	Focusable,
	TUI,
} from '@earendil-works/pi-tui'
import type { UiTheme } from '../ui/design-system/theme.ts'
import type { QuestionnaireCaptures } from './questionnaire-captures.ts'
import type { SelectionKeybindings } from './questionnaire-input.ts'
import type {
	AskResult,
	Question,
	QuestionnaireInitialState,
} from './questionnaire-model.ts'
import type { QuestionnaireEffect } from './questionnaire-navigation-state.ts'
import type { CanvasStripLines } from './questionnaire-render-primitives.ts'

interface CustomComponent extends Component, Focusable {
	handleInput(data: string): void
}

type CustomFactory<T> = (
	tui: TUI,
	theme: Theme,
	keybindings: SelectionKeybindings,
	done: (result: T) => void,
) => CustomComponent

export function runQuestionnaire(
	custom: <T>(factory: CustomFactory<T>) => Promise<T>,
	questions: Question[],
	initialState: QuestionnaireInitialState | undefined,
	captures: QuestionnaireCaptures,
): Promise<AskResult> {
	return custom<AskResult>(
		(tui, theme, keybindings, done) =>
			// House tokens only: the interactive dialog matches the transcript
			// frames, regardless of the runtime theme. The capture strip is the
			// one runtime-themed part, like every other capture strip surface.
			new QuestionnaireDialog(tui, {
				keybindings,
				done,
				questions,
				initialState,
				captures,
				stripTheme: theme,
			}),
	)
}

/** Live-dialog dependencies: the selection keybindings, the completion
 * callback, the question session, the capture strip wiring and any paused
 * state to restore. */
interface DialogTargets {
	readonly keybindings: SelectionKeybindings
	readonly done: (result: AskResult) => void
	readonly questions: Question[]
	readonly initialState?: QuestionnaireInitialState | undefined
	readonly captures: QuestionnaireCaptures
	readonly stripTheme: Theme
}

/** Live dialog widget: owns the editor, state machine and effect dispatch. */
class QuestionnaireDialog implements CustomComponent {
	private readonly tui: TUI
	private readonly done: (result: AskResult) => void
	private readonly state: QuestionnaireState
	private readonly captures: QuestionnaireCaptures
	private readonly stripTheme: Theme
	private readonly editor: Editor
	private readonly inputController: QuestionnaireInputController
	private cachedLines: string[] | undefined
	private cachedWidth: number | undefined

	constructor(tui: TUI, targets: DialogTargets) {
		this.tui = tui
		this.stripTheme = targets.stripTheme
		this.done = targets.done
		this.captures = targets.captures
		this.captures.bindRepaint(() => {
			this.invalidate()
			this.tui.requestRender()
		})
		this.editor = new Editor(tui, themeEditorTheme(uiTheme), {
			paddingX: 0,
		})
		this.state = new QuestionnaireState(
			targets.questions,
			this.editor,
			targets.initialState,
		)
		this.captures.attachDialogEditor(this.editor, targets.keybindings, () =>
			this.state.aliasReferenceTexts(),
		)
		// Enter inside the always-visible free-text editor.
		this.editor.onSubmit = answerText =>
			this.applyEffects(this.state.submitEditorText(answerText))
		this.inputController = new QuestionnaireInputController({
			state: this.state,
			editor: this.editor,
			keybindings: targets.keybindings,
			captures: this.captures,
			switchTab: delta => this.switchTab(delta),
			applyEffects: effects => this.applyEffects(effects),
		})
	}

	get focused(): boolean {
		return this.editor.focused
	}

	set focused(isFocused: boolean) {
		this.editor.focused = isFocused
	}

	render(width: number): string[] {
		if (!this.cachedLines || this.cachedWidth !== width) {
			this.cachedLines = renderQuestionnaire(
				this.state,
				this.editor,
				width,
				this.stripLines,
			)
			this.cachedWidth = width
		}
		return this.cachedLines
	}

	/** Strip lines against the current frame width; runtime-themed. */
	private readonly stripLines: CanvasStripLines = width =>
		this.captures.stripLines(this.stripTheme, width)

	invalidate(): void {
		this.editor.invalidate()
		this.cachedLines = undefined
		this.cachedWidth = undefined
	}

	handleInput(keystrokes: string): void {
		this.inputController.handleInput(keystrokes)
	}

	private refresh(): void {
		// Answers and drafts may have replaced their alias text in this batch.
		this.captures.prune(() => this.state.aliasReferenceTexts())
		this.cachedLines = undefined
		this.cachedWidth = undefined
		this.tui.requestRender()
	}

	private finish(outcome: 'submit' | 'cancel'): void {
		const answers = this.state.collectedAnswers()
		this.done(this.finishedResult(outcome, answers))
		this.dismiss()
	}

	/** The terminal result of one dialog, with its capture snapshot on submit. */
	private finishedResult(
		outcome: 'submit' | 'cancel',
		answers: AskResult['answers'],
	): AskResult {
		const captures = this.submittedCaptures(outcome, answers)
		const answerResult = {
			questions: [...this.state.allQuestions()],
			answers,
			cancelled: outcome === 'cancel',
		}
		return captures ? { ...answerResult, captures } : answerResult
	}

	/** Only a submitted dialog persists captures; a cancel replay shows none. */
	private submittedCaptures(
		outcome: 'submit' | 'cancel',
		answers: AskResult['answers'],
	): AskResult['captures'] {
		if (outcome !== 'submit' || !this.captures.isStripVisible)
			return undefined
		return this.captures.replayRecords(answerReferenceTexts(answers))
	}

	private finishChat(): void {
		const chat = this.state.chatRequest()
		if (!chat) return
		const references = [
			...answerReferenceTexts(this.state.collectedAnswers()),
			...Object.values(chat.initialState.drafts ?? {}),
		]
		this.done({
			questions: [...this.state.allQuestions()],
			answers: this.state.collectedAnswers(),
			cancelled: false,
			chat: {
				...chat,
				initialState: {
					...chat.initialState,
					captures: this.captures.replayRecords(references),
				},
			},
		})
		this.dismiss()
	}

	/** Block the strip's late repaints and paste insertions after this dialog. */
	private dismiss(): void {
		this.captures.bindRepaint(NO_REPAINT)
	}

	private switchTab(delta: -1 | 1): void {
		this.state.enterTab(
			(this.state.tab + delta + this.state.totalTabs) %
				this.state.totalTabs,
		)
		this.refresh()
	}

	private applyEffects(effects: QuestionnaireEffect[]): void {
		for (const effect of effects) {
			this.applyEffect(effect)
			if (TERMINAL_EFFECTS.has(effect)) return // terminal
		}
	}

	private applyEffect(effect: QuestionnaireEffect): void {
		switch (effect) {
			case 'render':
				return this.refresh()
			case 'advance': {
				const target = this.state.advanceTarget()
				if (target === 'submit') return this.finish('submit')
				this.state.enterTab(target)
				return this.refresh()
			}
			case 'submit':
				return this.finish('submit')
			case 'cancel':
				return this.finish('cancel')
			case 'chat':
				return this.finishChat()
		}
	}
}

/** Effects that end the questionnaire interaction. */
const TERMINAL_EFFECTS = new Set<QuestionnaireEffect>([
	'submit',
	'cancel',
	'chat',
])

/** Shared no-op so a finished strip never re-paints behind the dialog. */
const NO_REPAINT = (): void => {}

function themeEditorTheme(palette: UiTheme): EditorTheme {
	return {
		borderColor: text => palette.fg('accent', text),
		selectList: {
			selectedPrefix: text => palette.fg('accent', text),
			selectedText: text => palette.fg('accent', text),
			description: text => palette.fg('muted', text),
			scrollInfo: text => palette.fg('dim', text),
			noMatch: text => palette.fg('warning', text),
		},
	}
}
