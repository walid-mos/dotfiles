import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
	HANDOFF_CHOICES,
	MAX_SETTLE_RETRIES,
	budgetLevel,
	continuationText,
	handoffDirective,
	parseCeiling,
	shortTokens,
	shouldNudge,
	skillBody,
	statusText,
} from '../extensions/context-budget/budget.ts'
import {
	ContextGuard,
	handoffMessage,
} from '../extensions/context-budget/guard.ts'
import {
	handoffDir,
	handoffPath,
	isUsableHandoff,
	resolveSkillBody,
} from '../extensions/context-budget/handoff.ts'
import {
	readCeiling,
	writeCeiling,
} from '../extensions/context-budget/store.ts'
import { HandoffSummary } from '../extensions/context-budget/summary.ts'

import type { SlashCommandInfo } from '@earendil-works/pi-coding-agent'

const SESSION = '01a0a8eb-2fc9-74c5-82b7-68199baf6bc6'
const AT = new Date(2026, 8, 16, 8, 5)

function tmpDir(): string {
	return mkdtempSync(join(tmpdir(), 'context-budget-'))
}

function skillCommand(path: string, name: string): SlashCommandInfo {
	return {
		name,
		source: 'skill',
		sourceInfo: { path, source: name, scope: 'user', origin: 'top-level' },
	}
}

/** A guard over a temporary agent dir, with a stub for the written probe. */
function guardOver(
	agentDir: string,
	isWritten: (path: string) => boolean = () => false,
): ContextGuard {
	const guard = new ContextGuard({ agentDir, isWritten })
	guard.enable(128_000)
	return guard
}

test('budget levels split at the warning mark and the ceiling', () => {
	assert.equal(budgetLevel(95_999, 128_000), 'ok')
	assert.equal(budgetLevel(96_000, 128_000), 'warn')
	assert.equal(budgetLevel(127_999, 128_000), 'warn')
	assert.equal(budgetLevel(128_000, 128_000), 'handoff')
	assert.equal(budgetLevel(500_000, 128_000), 'handoff')
})

test('the budget stays silent well below the ceiling', () => {
	assert.equal(budgetLevel(57_000, 128_000), 'ok')
	assert.equal(budgetLevel(0, 56_000), 'ok')
})

test('short tokens stay readable at both scales', () => {
	assert.equal(shortTokens(56_000), '56k')
	assert.equal(shortTokens(127_600), '128k')
	assert.equal(shortTokens(428_000), '428k')
	assert.equal(shortTokens(1_050_000), '1.05M')
})

test('the status reports the prompt against the ceiling, not the window', () => {
	assert.equal(statusText(112_000, 128_000), 'ctx 112k/128k')
})

test('parse accepts a k suffix, bare tokens, and a bare k shorthand', () => {
	assert.equal(parseCeiling('96k'), 96_000)
	assert.equal(parseCeiling('96000'), 96_000)
	assert.equal(parseCeiling('96'), 96_000)
	assert.equal(parseCeiling(' 128K '), 128_000)
	assert.equal(parseCeiling('428k'), 428_000)
})

test('parse rejects nonsense and ceilings too small to work in', () => {
	assert.equal(parseCeiling(''), undefined)
	assert.equal(parseCeiling('soon'), undefined)
	assert.equal(parseCeiling('12k'), undefined)
	assert.equal(parseCeiling('-96k'), undefined)
	assert.equal(parseCeiling('96k extra'), undefined)
})

test('parse treats off as a disabled ceiling', () => {
	assert.equal(parseCeiling('off'), 'off')
	assert.equal(parseCeiling('OFF'), 'off')
	assert.equal(parseCeiling('none'), 'off')
})

test('the ceiling ladder is sorted, deduplicated and round-trippable', () => {
	const choices = [...HANDOFF_CHOICES]
	assert.deepEqual(
		choices,
		choices.toSorted((a, b) => a - b),
	)
	assert.equal(new Set(choices).size, choices.length)
	assert.equal(choices[0], 48_000)
	assert.equal(choices.at(-1), 428_000)
	// Every entry must survive the picker: shown short, parsed back exactly.
	for (const choice of choices) {
		assert.equal(parseCeiling(shortTokens(choice)), choice)
	}
})

test('nudges stop at the cap and repeat only on continued growth', () => {
	assert.equal(shouldNudge(127_999, 128_000, 0), false)
	assert.equal(shouldNudge(128_000, 128_000, 0), true)
	assert.equal(shouldNudge(140_000, 128_000, 1), false)
	assert.equal(shouldNudge(160_000, 128_000, 1), true)
	assert.equal(shouldNudge(400_000, 128_000, 2), false)
})

test('the skill body drops the frontmatter that configures the skill', () => {
	const markdown =
		'---\nname: handoff\ndescription: x\n---\n\nWrite it down.\n'
	assert.equal(skillBody(markdown), 'Write it down.')
})

test('the skill body tolerates markdown without frontmatter', () => {
	assert.equal(skillBody('Write it down.'), 'Write it down.')
})

test('the directive carries the path and the skill rules verbatim', () => {
	const directive = handoffDirective({
		ceiling: 128_000,
		path: '/tmp/handoffs/01a0a8eb-20260916-0805.md',
		body: 'Do not duplicate plans.',
	})
	assert.match(directive, /128k ceiling/)
	assert.match(directive, /\/tmp\/handoffs\/01a0a8eb-20260916-0805\.md/)
	assert.match(directive, /Do not duplicate plans\./)
	assert.match(directive, /three lines only/)
})

test('the directive still asks for a handoff when the skill is missing', () => {
	const directive = handoffDirective({
		ceiling: 56_000,
		path: '/tmp/handoff.md',
		body: undefined,
	})
	assert.match(directive, /reference existing artifacts/)
})

test('the continuation resumes the work without re-reading the handoff', () => {
	const continuation = continuationText()
	assert.match(continuation, /handoff you just wrote/)
	assert.match(continuation, /next step/)
	// The handoff is the context now: sending the agent back to the file would
	// pay for the same tokens twice.
	assert.doesNotMatch(continuation, /\.md/)
})

test('handoff paths are namespaced by session and local timestamp', () => {
	assert.equal(
		handoffPath('/agent', SESSION, AT),
		'/agent/handoffs/01a0a8eb-20260916-080500.md',
	)
	// A session can reach the ceiling twice within the same minute: the two
	// requests must not share a file, or the second one would consume the first
	// handoff when the agent ignores it.
	const later = new Date(AT.getTime() + 30_000)
	assert.notEqual(
		handoffPath('/agent', SESSION, later),
		handoffPath('/agent', SESSION, AT),
	)
})

test('a disabled guard never acts, whatever the prompt size', () => {
	const guard = new ContextGuard({
		agentDir: tmpDir(),
		isWritten: () => false,
	})
	guard.enable('off')
	assert.deepEqual(guard.next(900_000, SESSION, AT), { type: 'clear' })
})

test('the guard is silent below the warning mark and warns exactly once', () => {
	const guard = guardOver(tmpDir())
	assert.deepEqual(guard.next(40_000, SESSION, AT), { type: 'clear' })

	const warn = guard.next(100_000, SESSION, AT)
	assert.equal(warn.type, 'warn')
	if (warn.type !== 'warn') return
	assert.equal(warn.status, 'ctx 100k/128k')
	assert.equal(warn.ceiling, 128_000)

	// Same band on a later turn: status only, no second announcement.
	assert.deepEqual(guard.next(110_000, SESSION, AT), {
		type: 'status',
		status: 'ctx 110k/128k',
	})
})

test('the guard asks for a handoff at the ceiling, naming the file', () => {
	const agentDir = tmpDir()
	const guard = guardOver(agentDir)
	const action = guard.next(128_500, SESSION, AT)
	assert.equal(action.type, 'handoff')
	if (action.type !== 'handoff') return
	assert.equal(
		action.path,
		join(agentDir, 'handoffs', '01a0a8eb-20260916-080500.md'),
	)
	assert.equal(guard.handoffFile, action.path)
	assert.equal(action.status, 'ctx 129k/128k')
})

test('an ignored handoff request is repeated once, then never again', () => {
	const guard = guardOver(tmpDir())
	assert.equal(guard.next(128_000, SESSION, AT).type, 'handoff')
	// Small overshoot: do not nag.
	assert.equal(guard.next(140_000, SESSION, AT).type, 'status')
	// Kept growing: one repeat.
	assert.equal(guard.next(170_000, SESSION, AT).type, 'handoff')
	// Cap reached.
	assert.equal(guard.next(500_000, SESSION, AT).type, 'status')
})

test('a written handoff ends the guard for the session', () => {
	const agentDir = tmpDir()
	const guard = guardOver(agentDir, isUsableHandoff)
	const action = guard.next(130_000, SESSION, AT)
	assert.equal(action.type, 'handoff')
	if (action.type !== 'handoff') return

	mkdirSync(handoffDir(agentDir), { recursive: true })
	writeFileSync(action.path, 'goal, state, next step')
	assert.deepEqual(guard.next(400_000, SESSION, AT), {
		type: 'ready',
		status: 'handoff ready',
	})
})

test('a settled agent with no handoff request has nothing to do', () => {
	assert.deepEqual(guardOver(tmpDir()).settled(), { type: 'idle' })
})

test('a settled agent compacts from the handoff as soon as it exists', () => {
	const agentDir = tmpDir()
	const guard = guardOver(agentDir, isUsableHandoff)
	const action = guard.next(130_000, SESSION, AT)
	assert.equal(action.type, 'handoff')
	if (action.type !== 'handoff') return

	// Nothing written yet: ask again instead of stalling the chain.
	const reask = guard.settled()
	assert.equal(reask.type, 'reask')
	if (reask.type !== 'reask') return
	assert.equal(reask.path, action.path)
	assert.equal(reask.ceiling, 128_000)
	assert.equal(reask.retry, 1)

	mkdirSync(handoffDir(agentDir), { recursive: true })
	writeFileSync(action.path, 'goal, state, next step')
	assert.deepEqual(guard.settled(), { type: 'compact', path: action.path })
})

test('settle re-asks are bounded, then the guard reports and stops', () => {
	const guard = guardOver(tmpDir())
	const action = guard.next(130_000, SESSION, AT)
	assert.equal(action.type, 'handoff')
	if (action.type !== 'handoff') return

	const attempts = Array.from({ length: MAX_SETTLE_RETRIES }, () =>
		guard.settled(),
	)
	assert.deepEqual(
		attempts.map(attempt => attempt.type),
		Array.from({ length: MAX_SETTLE_RETRIES }, () => 'reask'),
	)
	assert.deepEqual(guard.settled(), { type: 'givenUp', path: action.path })

	// A new ceiling restarts the count instead of carrying the failure over.
	guard.enable(128_000)
	assert.deepEqual(guard.settled(), { type: 'idle' })
})

test('a settle re-ask says the file is still missing', () => {
	const request = {
		ceiling: 128_000,
		path: '/tmp/handoff.md',
		body: 'Rules.',
	}
	const reask = handoffDirective({ ...request, retry: 2 })
	assert.match(reask, /retry 2/)
	assert.match(reask, /Rules\./)
	assert.doesNotMatch(handoffDirective(request), /retry \d/)
})

test('handing off, resolving the ceiling, and re-enabling reset the guard', () => {
	const guard = guardOver(tmpDir())
	assert.equal(guard.next(130_000, SESSION, AT).type, 'handoff')
	guard.enable(56_000)
	assert.equal(guard.currentCeiling(), 56_000)
	assert.equal(guard.handoffFile, undefined)
	// 60k is over the new 56k ceiling: the count restarted.
	assert.equal(guard.next(60_000, SESSION, AT).type, 'handoff')
})

test('the steered message is the directive for that action', () => {
	const guard = guardOver(tmpDir())
	const action = guard.next(130_000, SESSION, AT)
	assert.equal(action.type, 'handoff')
	if (action.type !== 'handoff') return
	assert.match(handoffMessage(action, 'Rules.'), /Rules\./)
	assert.match(handoffMessage(action, 'Rules.'), new RegExp(action.path))
})

test('the ceiling round-trips through the state file', () => {
	const dir = tmpDir()
	assert.equal(readCeiling(dir), 128_000)
	writeCeiling(dir, 192_000)
	assert.equal(readCeiling(dir), 192_000)
	writeCeiling(dir, 'off')
	assert.equal(readCeiling(dir), 'off')
})

test('an unreadable state file falls back to the default', () => {
	const dir = tmpDir()
	writeFileSync(join(dir, 'context-budget.json'), 'not json at all')
	assert.equal(readCeiling(dir), 128_000)
})

test('the handoff skill resolves through the command registry', () => {
	const dir = tmpDir()
	const file = join(dir, 'SKILL.md')
	writeFileSync(file, '---\nname: handoff\n---\n\nRules here.\n')
	assert.equal(
		resolveSkillBody([skillCommand(file, 'skill:handoff')]),
		'Rules here.',
	)
})

test('a folder-shaped skill path still resolves its SKILL.md', () => {
	const dir = tmpDir()
	writeFileSync(join(dir, 'SKILL.md'), 'Rules here.')
	assert.equal(
		resolveSkillBody([skillCommand(dir, 'handoff')]),
		'Rules here.',
	)
})

test('no handoff skill, or no readable file, yields undefined', () => {
	assert.equal(resolveSkillBody([]), undefined)
	assert.equal(
		resolveSkillBody([skillCommand('/nowhere/SKILL.md', 'handoff')]),
		undefined,
	)
})

test('only a non-empty regular file counts as a usable handoff', () => {
	const dir = tmpDir()
	const empty = join(dir, 'empty.md')
	const written = join(dir, 'written.md')
	writeFileSync(empty, '')
	writeFileSync(written, 'content')
	const directory = join(dir, 'adir.md')
	mkdirSync(directory)
	assert.equal(isUsableHandoff(empty), false)
	assert.equal(isUsableHandoff(written), true)
	assert.equal(isUsableHandoff(directory), false)
	assert.equal(isUsableHandoff(join(dir, 'absent.md')), false)
})

test('the compaction summary is the armed handoff, claimed once', () => {
	const path = join(tmpDir(), 'handoff.md')
	writeFileSync(path, '# Handoff\n\n## Next step\n\nFinish.\n')
	const summary = new HandoffSummary()

	// Nothing armed: the compaction is not this extension's to steer.
	assert.deepEqual(summary.claim(), { type: 'idle' })

	summary.arm(path)
	assert.deepEqual(summary.claim(), {
		type: 'text',
		text: '# Handoff\n\n## Next step\n\nFinish.',
	})
	// Once only: a later compaction falls back to pi's own summary rather than
	// reusing a handoff that describes an older conversation.
	assert.deepEqual(summary.claim(), { type: 'idle' })
})

test('an armed but unreadable handoff is reported, never replaced', () => {
	const dir = tmpDir()
	const summary = new HandoffSummary()

	const empty = join(dir, 'empty.md')
	writeFileSync(empty, '   \n')
	summary.arm(empty)
	assert.deepEqual(summary.claim(), { type: 'missing', path: empty })

	summary.arm(join(dir, 'absent.md'))
	assert.equal(summary.claim().type, 'missing')
})

test('disarming drops a handoff the failed compaction never used', () => {
	const path = join(tmpDir(), 'handoff.md')
	writeFileSync(path, 'content')
	const summary = new HandoffSummary()

	summary.arm(path)
	summary.disarm()
	assert.deepEqual(summary.claim(), { type: 'idle' })
})
