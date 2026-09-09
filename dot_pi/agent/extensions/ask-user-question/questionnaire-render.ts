/** Live questionnaire content inside the shared house frame. */
import { uiTheme } from '../ui/design-system/theme.ts'
import { blockTitle, framedBlock, frameContentWidth } from '../ui/frame.ts'
import { GLYPH } from '../ui/selection-marker.ts'

import {
	renderQuestionBody,
	renderTabBar,
} from './questionnaire-render-options.ts'
import { helpText, renderSubmitBody } from './questionnaire-render-submit.ts'

import type { QuestionnaireCanvas } from './questionnaire-render-primitives.ts'
import type { QuestionnaireState } from './questionnaire-state.ts'

/** Frame the whole dialog: tab bar (multi), body rows, then edge labels. */
export function renderQuestionnaire(
	state: QuestionnaireState,
	editor: QuestionnaireCanvas['editor'],
	fullWidth: number,
): string[] {
	const inner: string[] = []
	const canvas: QuestionnaireCanvas = {
		state,
		editor,
		width: frameContentWidth(fullWidth),
		sink: line => inner.push(line),
	}
	if (state.isMulti) renderTabBar(canvas)
	if (state.isOnSubmitTab()) renderSubmitBody(canvas)
	else renderQuestionBody(canvas)
	return framedBlock({
		width: fullWidth,
		title: blockTitle('ask', progressLabel(state)),
		lines: inner,
		footer: footerLabel(state),
	})
}

/** `2/4` tab progress inside the block title for multi-question dialogs. */
function progressLabel(state: QuestionnaireState): string | undefined {
	if (!state.isMulti) return undefined
	return `${Math.min(state.tab + 1, state.totalTabs)}/${state.totalTabs}`
}

function footerLabel(state: QuestionnaireState): string {
	if (state.isOnSubmitTab() && state.allAnswered()) {
		return (
			uiTheme.fg('success', `${GLYPH.enter} submit`) +
			uiTheme.fg('dim', '  ·  esc cancel')
		)
	}
	return uiTheme.fg('dim', helpText(state))
}
