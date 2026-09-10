import assert from 'node:assert/strict'
import test from 'node:test'

import {
	ProcessTerminal,
	stripTerminalSequences,
	TuiMainScreen,
	visibleWidth,
} from '@earendil-works/pi-tui'

import { installActivityBorder } from '../extensions/prompt-telemetry/activity-border.ts'
import { createDefaultEditor } from '../extensions/ui/editor-decorator.ts'

import type {
	CustomEditor,
	KeybindingsManager,
} from '@earendil-works/pi-coding-agent'
import type { EditorTheme } from '@earendil-works/pi-tui'

const plain = (text: string): string => text

/** The editor only reads keybindings from handleInput, which no test sends. */
const unusedKeybindings = (): KeybindingsManager =>
	// oxlint-disable-next-line nextnode/no-type-assertion typescript/no-unsafe-type-assertion
	({}) as KeybindingsManager

const EDITOR_THEME: EditorTheme = {
	borderColor: plain,
	selectList: {
		selectedPrefix: plain,
		selectedText: plain,
		description: plain,
		scrollInfo: plain,
		noMatch: plain,
	},
}

/** pi ships no factory for the indicator; the editor reads `renderInBorder`. */
type WorkingIndicator = Parameters<CustomEditor['setWorkingStatusIndicator']>[0]

function stubWorkingIndicator(label: string): WorkingIndicator {
	// oxlint-disable-next-line nextnode/no-type-assertion typescript/no-unsafe-type-assertion
	return {
		renderInBorder: (width: number) => label.slice(0, width),
	} as WorkingIndicator
}

/** Real editor and compositor; the terminal is never started (no IO). */
function createPromptEditor(): CustomEditor {
	return createDefaultEditor(
		new TuiMainScreen(new ProcessTerminal()),
		EDITOR_THEME,
		unusedKeybindings(),
	)
}

function workingPrompt(activity: string): CustomEditor {
	const editor = createPromptEditor()
	editor.setWorkingStatusIndicator(stubWorkingIndicator('⠋ Pondering'))
	installActivityBorder(editor, () => activity)
	return editor
}

const ACTIVITY_BLOCK = '◴ 00:03 ━━━ 1.2k'
/** Border columns up to and including the space pi puts after the loader. */
const LOADER_PREFIX_WIDTH = 15
const PROMPT_WIDTH = 60
/** Dashes the block keeps between itself and the border's edge. */
const EDGE_DASHES = 1

void test('loader and activity block share the prompt top border', () => {
	const [border = ''] = workingPrompt(ACTIVITY_BLOCK).render(PROMPT_WIDTH)
	// Flush with the border's right edge, one dash of margin.
	const start = PROMPT_WIDTH - EDGE_DASHES - ACTIVITY_BLOCK.length

	assert.equal(visibleWidth(border), PROMPT_WIDTH)
	assert.equal(
		stripTerminalSequences(border),
		`── ⠋ Pondering ${'─'.repeat(start - LOADER_PREFIX_WIDTH)}${ACTIVITY_BLOCK}${'─'.repeat(PROMPT_WIDTH - start - ACTIVITY_BLOCK.length)}`,
	)
})

void test('the activity block never adds a line to the prompt', () => {
	const editor = workingPrompt(ACTIVITY_BLOCK)

	assert.equal(
		editor.render(PROMPT_WIDTH).length,
		createPromptEditor().render(PROMPT_WIDTH).length,
	)
})

void test('an idle activity leaves the loader alone in the border', () => {
	const editor = createPromptEditor()
	editor.setWorkingStatusIndicator(stubWorkingIndicator('⠋ Pondering'))
	installActivityBorder(editor, () => undefined)

	const [border = ''] = editor.render(PROMPT_WIDTH)

	assert.equal(
		stripTerminalSequences(border),
		`── ⠋ Pondering ${'─'.repeat(PROMPT_WIDTH - LOADER_PREFIX_WIDTH)}`,
	)
})
