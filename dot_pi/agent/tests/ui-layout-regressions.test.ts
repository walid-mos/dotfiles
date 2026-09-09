import assert from 'node:assert/strict'
import test from 'node:test'

import { stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui'

import { renderResultLines } from '../extensions/ask-user-question/questionnaire-transcript.ts'
import { createSurfaceRegistry } from '../extensions/ui/surface.ts'
import {
	terminalLineWidth,
	wrapTerminalLine,
} from '../extensions/ui/terminal-text.ts'

import type { AskResult } from '../extensions/ask-user-question/questionnaire-model.ts'

void test('terminal measurement counts graphemes, not individual code points', () => {
	assert.equal(terminalLineWidth('e\u0301'), 1)
	assert.equal(terminalLineWidth('👨\u200d👩\u200d👧\u200d👦'), 2)
	assert.equal(terminalLineWidth('🇫🇷'), 2)
})

void test('wrapping preserves explicit newlines and styled overlong words', () => {
	assert.deepEqual(wrapTerminalLine('first\nsecond', 20), [
		'first',
		'second',
	] as const)
	const lines = wrapTerminalLine('\u001b[31mabcdef\u001b[39m', 3)
	assert.deepEqual(lines.map(stripTerminalSequences), ['abc', 'def'] as const)
	assert.match(lines[1] ?? '', /\u001b\[31m/)
})

void test('surface overflow indicators respect narrow viewports', () => {
	const registry = createSurfaceRegistry()
	registry.register({
		id: 'overflow',
		placement: 'aboveEditor',
		maxLines: 1,
		render: () => ['first', 'second'],
	})
	assert.deepEqual(
		registry.render('aboveEditor', 3).map(stripTerminalSequences),
		['fi…', '… …'] as const,
	)
})

void test('answer replay preserves all words across wrapped styled lines', () => {
	const outcome: AskResult = {
		cancelled: false,
		questions: [
			{
				id: 'notes',
				label: 'Notes',
				prompt: 'Notes?',
				options: [],
				allowOther: true,
				multiSelect: false,
			},
		],
		answers: [
			{
				id: 'notes',
				kind: 'single',
				value: 'abcdefghijklmnop',
				label: 'abcdefghijklmnop',
				wasCustom: true,
			},
		],
	}
	const lines = renderResultLines(outcome, 16)
	const plain = lines.map(stripTerminalSequences).join('\n')
	assert.match(plain, /abcdefg/)
	assert.match(plain, /hijklmn/)
	assert.match(plain, /op/)
	assert.ok(lines.every(line => visibleWidth(line) <= 16))
})
