/**
 * Interactive questionnaire component to run through ctx.ui.custom(): owns
 * the render cache and the submit/cancel/advance/chat lifecycle, while input
 * routing is delegated to the router in questionnaire-inputs.ts and drawing
 * lives in questionnaire-render.ts.
 */

import { Editor as EditorWidget } from '@earendil-works/pi-tui'

import { QuestionnaireInputRouter } from './questionnaire-inputs.ts'
import { renderQuestionnaire } from './questionnaire-render.ts'
import { QuestionnaireState } from './questionnaire-state.ts'

import type { EditorTheme } from '@earendil-works/pi-tui'
import type { KeybindingsManager } from '@earendil-works/pi-tui'
import type { TUI } from '@earendil-works/pi-tui'
import type { Editor } from '@earendil-works/pi-tui'
import type {
	AskResult,
	Question,
	QuestionnaireSnapshot,
} from './questionnaire-model.ts'
import type {
	QuestionnairePalette,
	QuestionnaireView,
} from './questionnaire-render-kit.ts'
import type { EditorPort, QuestionnaireEffect } from './questionnaire-state.ts'

/** The factory ctx.ui.custom() receives: builds the questionnaire component. */
interface CustomComponent {
	render(width: number): string[]
	invalidate(): void
	handleInput(input: string): void
}

type ConfirmQuestionnaire = (result: AskResult) => void

/** The only custom-UI invocation the questionnaire needs: always yields AskResult. */
export type AskCustomUI = (factory: QuestionnaireFactory) => Promise<AskResult>

type QuestionnaireFactory = (
	tui: TUI,
	palette: QuestionnairePalette,
	keybindings: KeybindingsManager,
	confirm: ConfirmQuestionnaire,
) => CustomComponent

function editorThemeFrom(palette: QuestionnairePalette): EditorTheme {
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

/** Owns rendering and the questionnaire lifecycle; input routing is external. */
class QuestionnaireComponent {
	private readonly hooks: {
		theme: QuestionnairePalette
		requestRender(): void
	}
	private readonly confirm: ConfirmQuestionnaire
	private readonly questions: readonly Question[]
	private readonly state: QuestionnaireState
	private readonly editor: Editor
	private readonly inputRouter: QuestionnaireInputRouter

	private cachedLines: string[] | undefined
	private cachedWidth: number | undefined

	constructor(config: {
		tui: TUI
		palette: QuestionnairePalette
		keybindings: KeybindingsManager
		confirm: ConfirmQuestionnaire
		questions: readonly Question[]
		snapshot: QuestionnaireSnapshot | undefined
	}) {
		this.hooks = {
			theme: config.palette,
			requestRender: () => config.tui.requestRender(),
		}
		this.confirm = config.confirm
		this.questions = config.questions
		this.editor = new EditorWidget(
			config.tui,
			editorThemeFrom(config.palette),
			{ paddingX: 0 },
		)
		const editorPort: EditorPort = {
			getText: () => this.editor.getText(),
			setText: text => this.editor.setText(text),
		}
		this.state = new QuestionnaireState(
			config.questions,
			editorPort,
			config.snapshot,
		)
		this.editor.onSubmit = submitted =>
			this.applyEffects(this.state.submitEditorText(submitted))
		this.inputRouter = new QuestionnaireInputRouter({
			state: this.state,
			editor: this.editor,
			keybindings: config.keybindings,
			actions: {
				refresh: () => this.refresh(),
				applyEffects: effects => this.applyEffects(effects),
			},
		})
	}

	refresh(): void {
		this.cachedLines = undefined
		this.cachedWidth = undefined
		this.hooks.requestRender()
	}

	render(width: number): string[] {
		if (!this.cachedLines || this.cachedWidth !== width) {
			this.cachedLines = renderQuestionnaire(this.view(width))
			this.cachedWidth = width
		}
		return this.cachedLines
	}

	handleInput(input: string): void {
		this.inputRouter.handleInput(input)
	}

	invalidate(): void {
		this.cachedLines = undefined
		this.cachedWidth = undefined
	}

	private view(width: number): QuestionnaireView {
		return {
			state: this.state,
			questions: this.questions,
			editor: this.editor,
			theme: this.hooks.theme,
			width,
		}
	}

	private applyEffects(effects: QuestionnaireEffect[]): void {
		for (const effect of effects) {
			this.applyEffect(effect)
			if (effect === 'submit' || effect === 'cancel' || effect === 'chat')
				return // terminal
		}
	}

	private applyEffect(effect: QuestionnaireEffect): void {
		switch (effect) {
			case 'render':
				this.refresh()
				return
			case 'advance':
				this.advance()
				return
			case 'submit':
				this.finish(false)
				return
			case 'cancel':
				this.finish(true)
				return
			case 'chat':
				this.finishChat()
				return
		}
	}

	private advance(): void {
		const target = this.state.advanceTarget()
		if (target === 'submit') {
			this.finish(false)
			return
		}
		this.state.enterTab(target)
		this.refresh()
	}

	private finish(isCancelled: boolean): void {
		this.confirm({
			answers: this.state.collectedAnswers(),
			cancelled: isCancelled,
		})
	}

	private finishChat(): void {
		const chat = this.state.chatRequest()
		if (chat)
			this.confirm({
				answers: this.state.collectedAnswers(),
				cancelled: false,
				chat,
			})
	}
}

export function runQuestionnaire(
	custom: AskCustomUI,
	questions: readonly Question[],
	snapshot?: QuestionnaireSnapshot,
): Promise<AskResult> {
	return custom((tui, palette, keybindings, confirm) => {
		const component = new QuestionnaireComponent({
			tui,
			palette,
			keybindings,
			confirm,
			questions,
			snapshot,
		})
		return {
			render: width => component.render(width),
			invalidate: () => component.invalidate(),
			handleInput: input => component.handleInput(input),
		}
	})
}
