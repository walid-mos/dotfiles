import type { Editor } from '@earendil-works/pi-tui'
import type { LineSink } from '../ui/terminal-text.ts'
import type { QuestionnaireState } from './questionnaire-state.ts'

/** Dependencies of one live render pass; state owns the question list. */
export interface QuestionnaireCanvas {
	readonly state: QuestionnaireState
	readonly editor: Pick<Editor, 'getText' | 'render'>
	readonly width: number
	readonly sink: LineSink
}
