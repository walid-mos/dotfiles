import assert from 'node:assert/strict'
import test from 'node:test'

import { parseAskResult } from '../extensions/ask-user-question/questionnaire-normalization.ts'
import {
	renderCallLines,
	renderResultLines,
} from '../extensions/ask-user-question/questionnaire-transcript.ts'
import { terminalLineWidth } from '../extensions/ui/terminal-text.ts'

import type {
	AskResult,
	Answer,
	Question,
} from '../extensions/ask-user-question/questionnaire-model.ts'

const ANSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g

function stripAnsi(line: string): string {
	return line.replace(ANSI_PATTERN, '')
}

function assertWithinWidth(lines: string[], width: number): void {
	for (const line of lines) {
		assert.ok(
			terminalLineWidth(line) <= width,
			`line exceeds width ${width}: ${JSON.stringify(stripAnsi(line))}`,
		)
	}
}

const rawArgs = {
	questions: [
		{
			id: 'scope',
			label: 'Scope',
			prompt: 'Which scope should this pass cover?',
			options: [
				{
					label: 'Focused',
					description: 'Only the touched files',
					recommended: true,
				},
				{ label: 'Whole repo' },
			],
			multiSelect: false,
			allowOther: true,
		},
		{
			id: 'checks',
			label: 'Checks',
			prompt: 'Run the test suite?',
			options: ['Yes', 'No'],
			multiSelect: true,
		},
	],
}

const questions: Question[] = [
	{
		id: 'scope',
		label: 'Scope',
		prompt: 'Which scope should this pass cover?',
		options: [
			{
				value: 'Focused',
				label: 'Focused',
				description: 'Only the touched files',
				recommended: true,
			},
			{ value: 'Whole repo', label: 'Whole repo' },
		],
		allowOther: true,
		multiSelect: false,
	},
	{
		id: 'checks',
		label: 'Checks',
		prompt: 'Run the test suite?',
		options: [
			{ value: 'Yes', label: 'Yes' },
			{ value: 'No', label: 'No' },
		],
		allowOther: true,
		multiSelect: true,
	},
]

void test('call preview stays compact: labels only, no option noise', () => {
	const lines = renderCallLines(rawArgs, 100)
	const plain = lines.map(stripAnsi).join('\n')

	assertWithinWidth(lines, 100)
	assert.match(plain, /ask · 2 questions/)
	assert.match(plain, /Scope · Checks|Scope {2}· {2}Checks/)
	assert.match(plain, /awaiting answer/)
	assert.doesNotMatch(plain, /Focused/)
	assert.doesNotMatch(plain, /★ recommended/)
	assert.doesNotMatch(plain, /Whole repo/)
	assert.doesNotMatch(plain, /↳/)
})

void test('call preview survives malformed or streamed args', () => {
	const garbled = renderCallLines({ questions: 'not-an-array' }, 80)
	assertWithinWidth(garbled, 80)

	const partial = renderCallLines(
		{ questions: [{ id: 'a' }, null, { id: 'b', options: ['x', {}] }] },
		80,
	)
	assertWithinWidth(partial, 80)
})

void test('result replay fills markers for the selected options only', () => {
	const answers: Answer[] = [
		{
			kind: 'single',
			id: 'scope',
			value: 'Focused',
			label: 'Focused',
			wasCustom: false,
			index: 1,
		},
	]
	const details: AskResult = { questions, answers, cancelled: false }
	const lines = renderResultLines(details, 100)
	const plain = lines.map(stripAnsi).join('\n')

	assertWithinWidth(lines, 100)
	assert.match(plain, /✔ ask · 1 answer/)
	assert.match(plain, /◉ Focused/)
	assert.match(plain, /○ Whole repo/)
	assert.doesNotMatch(plain, /◉ Whole repo/)
})

void test('result replay renders multi answers, custom text and long prompts safely', () => {
	const answers: Answer[] = [
		{
			kind: 'multi',
			id: 'checks',
			value: 'Yes No extra',
			label: 'Yes, No',
			wasCustom: false,
			labels: ['Yes', 'No'],
			optionValues: ['Yes'],
			customText: 'No, but keep coverage',
		},
	]
	const details: AskResult = { questions, answers, cancelled: false }
	const lines = renderResultLines(details, 40)
	const plain = lines.map(stripAnsi).join('\n')

	assertWithinWidth(lines, 40)
	assert.match(plain, /▣ Yes/)
	assert.match(plain, /□ No/)
	assert.match(plain, /✎ No, but keep coverage/)
})

void test('cancelled and chat results keep the block frame', () => {
	const cancelled = renderResultLines(
		{ questions, answers: [], cancelled: true },
		80,
	)
	const cancelledPlain = cancelled.map(stripAnsi).join('\n')
	assertWithinWidth(cancelled, 80)
	assert.match(cancelledPlain, /ask · cancelled/)
	assert.match(cancelledPlain, /no answer/)

	const chat = renderResultLines(
		{
			questions,
			answers: [],
			cancelled: false,
			chat: { question: questions[0]!, initialState: { answers: [] } },
		},
		80,
	)
	const chatPlain = chat.map(stripAnsi).join('\n')
	assertWithinWidth(chat, 80)
	assert.match(chatPlain, /ask · chat/)
})

void test('result replay renders schema-coerced details and refuses the rest', () => {
	// Regression: details missing fields crashed renderResultLines and killed
	// the whole TUI on session load. The schema parse refuses unusable payloads
	// and coerces schema-valid ones through the declared defaults.
	assert.equal(parseAskResult({ cancelled: false }), undefined)

	const parsed = parseAskResult({
		questions: [
			{
				id: 'scope',
				label: 'Scope',
				prompt: 'Which scope should this pass cover?',
				options: [],
			},
			{
				id: 'checks',
				label: 'Checks',
				prompt: 'Run the test suite?',
				options: [],
			},
		],
		answers: [
			{
				kind: 'multi',
				id: 'scope',
				value: 'everything but tests',
				label: 'everything but tests',
				wasCustom: false,
				labels: ['everything but tests'],
				optionValues: [],
				customText: 'everything but tests',
			},
		],
	})
	assert.ok(parsed)

	const lines = renderResultLines(parsed, 40)
	const plain = lines.map(stripAnsi).join('\n')
	assertWithinWidth(lines, 40)
	assert.match(plain, /✔ ask · 1 answer/)
	assert.match(plain, /\[Scope\]/)
	assert.match(plain, /✎ everything but tests/)
	assert.match(plain, /\[Checks\]/)
	assert.match(plain, /· no answer/)
})
