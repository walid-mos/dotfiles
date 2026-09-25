import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { GoalGate } from '../extensions/goal-gate/gate.ts'
import {
	declareItems,
	dismissRequest,
} from '../extensions/goal-gate/ledger-edits.ts'
import {
	canCloseRequest,
	ledgerStatus,
	requestItem,
} from '../extensions/goal-gate/ledger.ts'
import {
	decideRoute,
	decideScope,
	proposeScope,
	routeInstruction,
	scopeInstruction,
	ROUTING_QUESTION,
} from '../extensions/goal-gate/routing.ts'
import { watchTaskRouting } from '../extensions/goal-gate/task-routing.ts'

import { routingCases, scopeCases } from './task-routing-cases.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

/* oxlint-disable nextnode/no-type-assertion -- Pi's ExtensionAPI has unrelated methods; the test fake only supplies on(). */

describe('task routing', () => {
	it('classifies only answer versus work before discovery', () => {
		assert.deepEqual(Object.keys(ROUTING_QUESTION.criteria), [
			'answer',
			'work',
		])
		assert.equal(routingCases.length, 48)
		assert.equal(scopeCases.length, 4)
	})

	it('treats uncertain or invalid first-stage choices as work', () => {
		assert.equal(
			decideRoute({ choice: 'answer', confidence: 0.44 }),
			'work',
		)
		assert.equal(decideRoute({ choice: 'other', confidence: 0.99 }), 'work')
		assert.equal(
			decideRoute({ choice: 'work', confidence: Number.NaN }),
			'work',
		)
		assert.equal(
			decideRoute({ choice: 'answer', confidence: Infinity }),
			'work',
		)
	})

	it('accepts a confident answer and work at the decision boundary', () => {
		assert.equal(
			decideRoute({ choice: 'answer', confidence: 0.45 }),
			'answer',
		)
		assert.equal(decideRoute({ choice: 'work', confidence: 0.8 }), 'work')
	})

	it('proposes scope from deliverables and lets Jev review with a scoped uncertainty bias', () => {
		assert.equal(proposeScope(['Rename button']), 'direct')
		assert.equal(proposeScope(['Inspect API', 'Verify UI']), 'scoped')
		assert.equal(
			decideScope({ choice: 'direct', confidence: 0.8 }),
			'direct',
		)
		assert.equal(
			decideScope({ choice: 'direct', confidence: 0.44 }),
			'scoped',
		)
		assert.equal(
			decideScope({ choice: 'direct', confidence: Infinity }),
			'scoped',
		)
		assert.match(scopeInstruction('scoped'), /independent, substantial/)
		assert.match(scopeInstruction('scoped'), /SAME goal ledger/)
		assert.match(
			routeInstruction('work', { hasOpenGoal: false }),
			/declare concrete deliverables with `goal`/,
		)
	})

	it('keeps questions free of new work while preserving a previous goal', () => {
		assert.match(
			routeInstruction('answer', { hasOpenGoal: true }),
			/keep it intact/,
		)
		assert.doesNotMatch(
			routeInstruction('answer', { hasOpenGoal: false }),
			/declare/,
		)
	})

	it('seeds one goal for work, then reuses it for follow-ups', async () => {
		const handlers = new Map<string, (event: unknown) => unknown>()
		const pi = {
			on: (name: string, handler: (event: unknown) => unknown) =>
				handlers.set(name, handler),
		} as unknown as ExtensionAPI
		const files = new Map<string, string>()
		const ledger = {
			read: (path: string) => files.get(path),
			write: (path: string, text: string) => {
				files.set(path, text)
			},
		}
		const gate = new GoalGate({
			agentDir: '/tmp/test-agent',
			read: ledger.read,
		})
		const path = gate.arm('12345678-1234-1234-1234-123456789abc')
		watchTaskRouting(pi, gate, ledger, {
			classify: async () => ({ route: 'work' }),
		})
		handlers.get('session_start')?.({})
		handlers.get('input')?.({
			source: 'interactive',
			text: 'Refactor all screens',
		})
		const first = await handlers.get('before_agent_start')?.({})
		assert.equal(ledgerStatus(files.get(path) ?? '').open.length, 1)
		assert.match(JSON.stringify(first), /declare concrete deliverables/)
		handlers.get('input')?.({ source: 'rpc', text: 'Also check mobile' })
		const followUp = await handlers.get('before_agent_start')?.({})
		assert.equal(ledgerStatus(files.get(path) ?? '').open.length, 1)
		assert.match(JSON.stringify(followUp), /already open/)
		assert.equal(gate.settled().type, 'continue')
	})

	it('does not seed a question or classify a synthetic continuation', async () => {
		const handlers = new Map<string, (event: unknown) => unknown>()
		const pi = {
			on: (name: string, handler: (event: unknown) => unknown) =>
				handlers.set(name, handler),
		} as unknown as ExtensionAPI
		const files = new Map<string, string>()
		const ledger = {
			read: (path: string) => files.get(path),
			write: (path: string, text: string) => {
				files.set(path, text)
			},
		}
		const gate = new GoalGate({
			agentDir: '/tmp/test-agent',
			read: ledger.read,
		})
		const path = gate.arm('12345678-1234-1234-1234-123456789abc')
		let classified = 0
		watchTaskRouting(pi, gate, ledger, {
			classify: async () => {
				classified += 1
				return { route: 'answer' }
			},
		})
		handlers.get('session_start')?.({})
		handlers.get('input')?.({
			source: 'interactive',
			text: 'What is a goal?',
		})
		const answer = await handlers.get('before_agent_start')?.({})
		assert.match(JSON.stringify(answer), /without creating a new goal/)
		assert.equal(files.has(path), false)
		handlers.get('input')?.({ source: 'extension', text: 'Still open' })
		assert.equal(await handlers.get('before_agent_start')?.({}), undefined)
		assert.equal(classified, 1)
	})

	it('warns and seeds a goal when Jev is unavailable', async () => {
		const handlers = new Map<string, (event: unknown) => unknown>()
		const pi = {
			on: (name: string, handler: (event: unknown) => unknown) =>
				handlers.set(name, handler),
		} as unknown as ExtensionAPI
		const files = new Map<string, string>()
		const ledger = {
			read: (path: string) => files.get(path),
			write: (path: string, text: string) => {
				files.set(path, text)
			},
		}
		const gate = new GoalGate({
			agentDir: '/tmp/test-agent',
			read: ledger.read,
		})
		const path = gate.arm('12345678-1234-1234-1234-123456789abc')
		watchTaskRouting(pi, gate, ledger, {
			classify: async () => {
				throw new Error('service unavailable')
			},
		})
		handlers.get('input')?.({
			source: 'interactive',
			text: 'Fix the whole app',
		})
		const response = await handlers.get('before_agent_start')?.({})
		assert.equal(ledgerStatus(files.get(path) ?? '').open.length, 1)
		assert.match(JSON.stringify(response), /Jev.*unavailable/)
		assert.match(JSON.stringify(response), /declare concrete deliverables/)
	})

	it('keeps the request-level audit open until concrete work is checked', () => {
		const request = requestItem('abcd-1')
		assert.equal(canCloseRequest(ledgerStatus(`- [ ] ${request}\n`)), false)
		assert.equal(
			canCloseRequest(
				ledgerStatus(`- [ ] ${request}\n- [ ] Verify all screens\n`),
			),
			false,
		)
		assert.equal(
			canCloseRequest(
				ledgerStatus(
					`- [ ] ${request}\n- [x] Verify all screens - browser checked\n`,
				),
			),
			true,
		)
	})

	it('preserves existing goal items when a request-level item is declared', () => {
		const existing = '# Goal\n\n- [x] Inspect API - done\n- [ ] Verify UI\n'
		const updated = declareItems(existing, [
			'Request 42: complete this user task end-to-end (see user prompt)',
		])
		assert.deepEqual(ledgerStatus(updated.text).open, [
			'Verify UI',
			'Request 42: complete this user task end-to-end (see user prompt)',
		])
		assert.match(updated.text, /- \[x\] Inspect API - done/)
	})

	it('dismisses only an empty current request, leaving completed history intact', () => {
		const request = requestItem('abcd-1')
		const previous = '- [x] Earlier task - complete\n'
		const dismissed = dismissRequest(
			`# Goal\n${previous}- [ ] ${request}\n`,
			'Only an explanation was requested',
		)
		assert.deepEqual(ledgerStatus(dismissed).open, [])
		assert.match(dismissed, /Only an explanation was requested/)
		assert.throws(
			() =>
				dismissRequest(
					`# Goal\n${previous}- [ ] ${request}\n- [x] Inspect repo - done\n`,
					'No work',
				),
			/concrete work was declared/,
		)
	})
})
