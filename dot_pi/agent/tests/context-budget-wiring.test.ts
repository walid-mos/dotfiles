/**
 * Wiring checks for `extensions/context-budget/index.ts`.
 *
 * The guard's decisions are unit-tested in `context-budget.test.ts`; this file
 * proves the extension *acts* on them, which is what the chain hangs on: a
 * settled agent must be continued automatically from the handoff, with no human
 * command, by compacting the session in place - so the transcript, the model
 * and the thinking level all survive - with the handoff as the summary of that
 * compaction, and pi's own summary never used.
 *
 * `PI_CODING_AGENT_DIR` points every state file at a throwaway directory, so
 * nothing here touches the real agent dir. Tests in one file share a process,
 * so a distinct session id per test keeps their handoffs apart.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { setTimeout as tick } from 'node:timers/promises'

import contextBudget from '../extensions/context-budget/index.ts'

import type {
	CompactOptions,
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'

const AGENT_DIR = mkdtempSync(join(tmpdir(), 'context-budget-wiring-'))
process.env.PI_CODING_AGENT_DIR = AGENT_DIR

after(() => {
	rmSync(AGENT_DIR, { recursive: true, force: true })
	Reflect.deleteProperty(process.env, 'PI_CODING_AGENT_DIR')
})

/** The default ceiling (128k) crossed by a margin. */
const OVER_CEILING = 130_000
const HANDOFF = '# Handoff\n\n## Next step\n\nFinish the work.\n'

type SentMessage = {
	content: string
	options?: { deliverAs?: string } | undefined
}
type EventHandler = (event: unknown, ctx: ExtensionContext) => unknown

/**
 * The pi types carry dozens of members and these doubles implement only the
 * few the wiring reads: rebuilding them in full would test the type, not the
 * wiring, so each double is narrowed once here.
 */
function double<T>(candidate: unknown): T {
	// oxlint-disable-next-line nextnode/no-type-assertion
	return candidate as T
}

type Harness = {
	pi: ExtensionAPI
	sent: SentMessage[]
	/** Every `ctx.compact()` the extension asked pi for. */
	compactions: CompactOptions[]
	/** Emit an event; returns what each handler returned, in order. */
	emit: (
		event: string,
		ctx: ExtensionContext,
		payload?: Record<string, unknown>,
	) => Promise<unknown[]>
}

function harness(): Harness {
	const sent: SentMessage[] = []
	const compactions: CompactOptions[] = []
	const handlers = new Map<string, EventHandler[]>()
	const raw = {
		on: (event: string, handler: EventHandler) => {
			handlers.set(event, [...(handlers.get(event) ?? []), handler])
		},
		sendUserMessage: (
			content: string,
			options?: SentMessage['options'],
		) => {
			sent.push({ content, options })
		},
		getCommands: () => [],
		registerCommand: () => undefined,
	}
	return {
		pi: double<ExtensionAPI>(raw),
		sent,
		compactions,
		emit: async (event, ctx, payload) => {
			const results: unknown[] = []
			for (const handler of handlers.get(event) ?? []) {
				// Sequential on purpose: pi awaits extension handlers in order.
				// oxlint-disable-next-line no-await-in-loop
				results.push(await handler(payload ?? {}, ctx))
			}
			return results
		},
	}
}

const NOTIFIED: string[] = []

function sessionContext(
	sessionId: string,
	tokens: number,
	compactions: CompactOptions[],
): ExtensionContext {
	return double<ExtensionContext>({
		mode: 'tui',
		ui: {
			notify: (message: string) => NOTIFIED.push(message),
			setStatus: () => undefined,
		},
		getContextUsage: () => ({ tokens }),
		sessionManager: { getSessionId: () => sessionId },
		compact: (options?: CompactOptions) => {
			compactions.push(options ?? {})
		},
	})
}

/** The handoff path the extension just asked the agent to write. */
function requestedPath(sent: SentMessage[]): string {
	const directive = sent.at(-1)?.content ?? ''
	const match = /Write it to: (\S+)/.exec(directive)
	assert.ok(match, `no handoff path in: ${directive.slice(0, 120)}`)
	return match[1] ?? ''
}

/** Drive one session to the ceiling and write the handoff it asked for. */
async function upToHandoff(
	harnessed: Harness,
	sessionId: string,
): Promise<{ ctx: ExtensionContext; path: string }> {
	const ctx = sessionContext(sessionId, OVER_CEILING, harnessed.compactions)
	await harnessed.emit('session_start', ctx)
	await harnessed.emit('turn_end', ctx)
	const path = requestedPath(harnessed.sent)
	// Fail loudly instead of writing into the real agent dir.
	assert.ok(path.startsWith(AGENT_DIR), `unexpected path: ${path}`)
	writeFileSync(path, HANDOFF)
	return { ctx, path }
}

/** The payload pi sends with its compaction hooks. */
function compactionEvent(): Record<string, unknown> {
	return {
		preparation: {
			firstKeptEntryId: 'entry-7',
			tokensBefore: OVER_CEILING,
		},
	}
}

test('a settled agent continues by compacting the session from the handoff', async () => {
	const harnessed = harness()
	contextBudget(harnessed.pi)
	const { ctx } = await upToHandoff(harnessed, 'aaaaaaaa-0000')

	// The chain continues on its own: no command, no replacement session.
	await harnessed.emit('agent_settled', ctx)
	assert.equal(harnessed.compactions.length, 1)

	// pi compacts; the hook hands it the handoff's own text, not a summary.
	assert.deepEqual(
		(
			await harnessed.emit(
				'session_before_compact',
				ctx,
				compactionEvent(),
			)
		).at(-1),
		{
			compaction: {
				summary: HANDOFF.trim(),
				firstKeptEntryId: 'entry-7',
				tokensBefore: OVER_CEILING,
			},
		},
	)
	// Claimed once: a later compaction keeps pi's own summary.
	assert.equal(
		(await harnessed.emit('session_before_compact', ctx)).at(-1),
		undefined,
	)

	// Compaction alone leaves an idle agent: the continuation comes from here.
	harnessed.compactions.at(-1)?.onComplete?.({
		summary: '',
		firstKeptEntryId: '',
		tokensBefore: 0,
	})
	await tick(1)
	assert.match(harnessed.sent.at(-1)?.content ?? '', /handoff you just wrote/)

	// Re-armed, and this cycle is closed: the settle that follows the
	// continuation must not consume the same handoff again.
	const asked = harnessed.sent.length
	await harnessed.emit('agent_settled', ctx)
	assert.equal(harnessed.compactions.length, 1)
	assert.equal(harnessed.sent.length, asked)

	// A new crossing asks again, from a fresh cycle.
	await harnessed.emit('turn_end', ctx)
	assert.equal(harnessed.sent.length, asked + 1)
	assert.match(harnessed.sent.at(-1)?.content ?? '', /Write it to:/)
})

test('a run that never writes the handoff is re-asked, then reported', async () => {
	const harnessed = harness()
	contextBudget(harnessed.pi)
	const ctx = sessionContext(
		'bbbbbbbb-0000',
		OVER_CEILING,
		harnessed.compactions,
	)
	await harnessed.emit('session_start', ctx)
	await harnessed.emit('turn_end', ctx)

	// One settle per retry, then the run that gives up: written out rather than
	// looped so the ladder each attempt consumes stays visible.
	const settle = async (): Promise<void> => {
		await harnessed.emit('agent_settled', ctx)
		await tick(1)
	}
	await settle()
	assert.match(harnessed.sent.at(-1)?.content ?? '', /retry 1/)
	await settle()
	await settle()
	await settle()

	assert.match(NOTIFIED.at(-1) ?? '', /No handoff at .* after 3 retries/)
	// Nothing was written, so there was never anything to compact.
	assert.equal(harnessed.compactions.length, 0)
})

test('a compaction this extension did not ask for keeps its own summary', async () => {
	const harnessed = harness()
	contextBudget(harnessed.pi)
	const ctx = sessionContext(
		'dddddddd-0000',
		OVER_CEILING,
		harnessed.compactions,
	)

	// A hand-typed /compact, with nothing armed: pi stays in charge of it.
	assert.equal(
		(
			await harnessed.emit(
				'session_before_compact',
				ctx,
				compactionEvent(),
			)
		).at(-1),
		undefined,
	)
})

test('a handoff that vanished refuses the compaction instead of replacing it', async () => {
	const harnessed = harness()
	contextBudget(harnessed.pi)
	const { ctx, path } = await upToHandoff(harnessed, 'eeeeeeee-0000')
	await harnessed.emit('agent_settled', ctx)
	rmSync(path)

	// pi's generic summary is not a substitute for the handoff, so the
	// compaction is cancelled rather than performed with the wrong text.
	assert.deepEqual(
		(
			await harnessed.emit(
				'session_before_compact',
				ctx,
				compactionEvent(),
			)
		).at(-1),
		{ cancel: true },
	)
	assert.match(NOTIFIED.at(-1) ?? '', /compaction cancelled/)
})

test('a failed compaction is reported and its arming dropped', async () => {
	const harnessed = harness()
	contextBudget(harnessed.pi)
	const { ctx } = await upToHandoff(harnessed, 'ffffffff-0000')
	await harnessed.emit('agent_settled', ctx)
	harnessed.compactions.at(-1)?.onError?.(new Error('no capacity'))
	assert.match(NOTIFIED.at(-1) ?? '', /no capacity/)

	// Disarmed: the next compaction is not handed a handoff nobody asked for.
	assert.equal(
		(
			await harnessed.emit(
				'session_before_compact',
				ctx,
				compactionEvent(),
			)
		).at(-1),
		undefined,
	)
})

test('a compaction pi started itself re-arms the ceiling guard', async () => {
	const harnessed = harness()
	contextBudget(harnessed.pi)
	const ctx = sessionContext(
		'99999999-0000',
		OVER_CEILING,
		harnessed.compactions,
	)
	await harnessed.emit('session_start', ctx)
	await harnessed.emit('turn_end', ctx)
	const asked = harnessed.sent.length

	// pi's own threshold compaction, nothing to do with this extension: the
	// prompt shrank, so the ceiling deserves a fresh cycle.
	await harnessed.emit('session_compact', ctx)
	await harnessed.emit('turn_end', ctx)
	assert.equal(harnessed.sent.length, asked + 1)
})

test('a compaction that fails after the hook is reported once', async () => {
	const harnessed = harness()
	contextBudget(harnessed.pi)
	const ctx = sessionContext(
		'88888888-0000',
		OVER_CEILING,
		harnessed.compactions,
	)

	await harnessed.emit('session_compact_failed', ctx, {
		fromExtension: true,
		errorMessage: 'provider down',
	})
	assert.match(NOTIFIED.at(-1) ?? '', /provider down/)

	// pi's own failure is pi's business.
	await harnessed.emit('session_compact_failed', ctx, {
		fromExtension: false,
		errorMessage: 'noise',
	})
	assert.doesNotMatch(NOTIFIED.at(-1) ?? '', /noise/)
})
