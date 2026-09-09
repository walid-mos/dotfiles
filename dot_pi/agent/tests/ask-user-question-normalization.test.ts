import assert from 'node:assert/strict'
import test from 'node:test'

import {
	normalizeQuestions,
	parseAskResult,
} from '../extensions/ask-user-question/questionnaire-normalization.ts'

void test('normalization trims text and applies questionnaire defaults', () => {
	assert.deepEqual(
		normalizeQuestions([
			{
				id: ' scope ',
				prompt: ' Choose a scope ',
				options: [
					{ label: ' Focused ', description: ' Small change ' },
				],
			},
		]),
		[
			{
				id: 'scope',
				label: 'Q1',
				prompt: 'Choose a scope',
				options: [
					{
						value: 'Focused',
						label: 'Focused',
						description: 'Small change',
						recommended: undefined,
					},
				],
				allowOther: true,
				multiSelect: false,
			},
		],
	)
})

void test('open-ended questions cannot remain multi-select', () => {
	const [question] = normalizeQuestions([
		{ id: 'details', prompt: 'Explain', multiSelect: true },
	])
	assert.equal(question?.multiSelect, false)
})

void test('duplicate normalized question ids are rejected', () => {
	assert.throws(
		() =>
			normalizeQuestions([
				{ id: 'scope', prompt: 'First' },
				{ id: ' scope ', prompt: 'Second' },
			]),
		/Duplicate question id "scope"/,
	)
})

void test('duplicate normalized option values are rejected', () => {
	assert.throws(
		() =>
			normalizeQuestions([
				{
					id: 'scope',
					prompt: 'Choose',
					options: [
						{ label: 'First', value: 'same' },
						{ label: 'Second', value: ' same ' },
					],
				},
			]),
		/duplicate option value "same"/,
	)
})

void test('blank semantic fields are rejected after trimming', () => {
	assert.throws(
		() => normalizeQuestions([{ id: ' ', prompt: 'Choose' }]),
		/Question 1 id must not be blank/,
	)
	assert.throws(
		() => normalizeQuestions([{ id: 'scope', prompt: ' ' }]),
		/Question "scope" prompt must not be blank/,
	)
})

void test('parseAskResult applies schema rules to replayed details', () => {
	assert.deepEqual(
		parseAskResult({
			questions: [
				{ id: 'scope', label: 'Scope', prompt: 'Choose a scope' },
			],
			answers: [],
		}),
		{
			questions: [
				{
					id: 'scope',
					label: 'Scope',
					prompt: 'Choose a scope',
					options: [],
					allowOther: true,
					multiSelect: false,
				},
			],
			answers: [],
			cancelled: false,
		},
	)
})

void test('parseAskResult refuses unusable details payloads', () => {
	assert.equal(parseAskResult(undefined), undefined)
	assert.equal(parseAskResult('cancelled'), undefined)
	assert.equal(parseAskResult({ answers: [] }), undefined)
	assert.equal(parseAskResult({ questions: [] }), undefined)
	assert.equal(
		parseAskResult({ questions: [{ id: 'x' }], answers: [] }),
		undefined,
	)
})
