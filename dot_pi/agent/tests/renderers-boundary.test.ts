import assert from 'node:assert/strict'
import test, { after } from 'node:test'

import { isFocusable, Text } from '@earendil-works/pi-tui'

import { installRenderers } from '../extensions/renderers/install-renderers.ts'

import {
	click,
	complete,
	runtime,
	toolRow,
	visible,
} from './renderers-fixture.ts'

import type { Component, Focusable } from '@earendil-works/pi-tui'

after(installRenderers(runtime))

void test('native renderer envelope reassignment cannot mutate the stored tool result', () => {
	const row = toolRow(
		'mutating_plugin',
		{},
		{
			renderResult(toolResult) {
				Reflect.set(toolResult, 'content', [
					{ type: 'text', text: 'overwritten' },
				])
				return new Text('Presentation only', 0, 0)
			},
		},
	)
	const outcome = {
		content: [{ type: 'text', text: 'Stored evidence' }],
		isError: false,
	}
	row.updateResult(outcome)
	row.setExpanded(true)
	assert.equal(outcome.content[0]?.text, 'Stored evidence')
	assert.ok(visible(row.render(80)).includes('│   Presentation only'))
})

void test('malformed render lines from a valid component cannot replace evidence with undefined', () => {
	const component = new Text('valid', 0, 0)
	Reflect.set(component, 'render', () => [undefined])
	const row = toolRow(
		'malformed_lines',
		{},
		{ renderResult: () => component },
	)
	complete(row, 'Evidence must survive')
	row.setExpanded(true)
	assert.ok(visible(row.render(80)).includes('│   Evidence must survive'))
})

void test('a bare string from a native slot is rejected before container flattening', () => {
	const component = new Text('valid', 0, 0)
	Reflect.set(component, 'render', () => 'bad')
	const row = toolRow('bare_string', {}, { renderResult: () => component })
	complete(row, 'Evidence must survive')
	row.setExpanded(true)
	assert.ok(visible(row.render(80)).includes('│   Evidence must survive'))
})

void test('a failure during component rendering falls back to the original output', () => {
	const row = toolRow(
		'render_crash',
		{},
		{
			renderResult: () => ({
				render() {
					throw new Error('paint failure')
				},
				invalidate() {
					/* No cached lines. */
				},
			}),
		},
	)
	complete(row, 'Failure details')
	row.setExpanded(true)
	assert.ok(visible(row.render(80)).includes('│   Failure details'))
})

void test('native slot validation preserves mouse controls, keyboard focus and input', () => {
	let clicks = 0
	let typedInput = ''
	const control: Component & Focusable = {
		focused: false,
		render: () => ['native control'],
		invalidate() {
			/* No cached text. */
		},
		handleMouse() {
			clicks += 1
			return { handled: true, focus: true }
		},
		handleInput(input) {
			typedInput = input
		},
	}
	const row = toolRow(
		'interactive_plugin',
		{},
		{ renderResult: () => control },
	)
	complete(row)
	row.setExpanded(true)
	row.render(80)
	const response = row.handleMouse(click(1))
	assert.equal(clicks, 1)
	assert.ok(response?.focusTarget)
	if (isFocusable(response.focusTarget)) response.focusTarget.focused = true
	response.focusTarget.handleInput?.('confirm')
	assert.equal(control.focused, true)
	assert.equal(typedInput, 'confirm')
})

void test('native slots still receive completion after collapse to retire their live resources', () => {
	let isNativeResourceActive = false
	const row = toolRow(
		'resource_plugin',
		{},
		{
			renderResult(_toolResult, options) {
				isNativeResourceActive = options.isPartial
				return new Text(
					options.isPartial ? 'live resource' : 'released',
					0,
					0,
				)
			},
		},
	)
	row.updateResult(
		{ content: [{ type: 'text', text: 'partial' }], isError: false },
		true,
	)
	row.setExpanded(true)
	assert.equal(isNativeResourceActive, true)
	row.setExpanded(false)
	complete(row)
	assert.equal(isNativeResourceActive, false)
})
