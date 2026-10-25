/**
 * Loop breaker for model-issued tool calls.
 *
 * Three streaks are measured over consecutive model turns since the last human
 * prompt: the same tool called with identical arguments; the same tool called
 * with arguments and output that differ only in their numbers (a counter, a
 * clock or an elapsed time posing as progress); and the same tool answering
 * with identical non-empty output whatever the arguments. A streak
 * past its limit blocks the call; every further turn that repeats it escalates:
 * block, then end the run after the batch, then abort the run. Nested calls
 * (lookup, codemode scripts) are not model decisions and stay out of history.
 */
import { createHash } from 'node:crypto'

/** Turns in a row calling one tool with the exact same arguments before the next such call is blocked. */
export const MAX_IDENTICAL_CALLS = 3
/** Turns in a row calling one tool with arguments and output equal once every number is masked before the next such call is blocked. */
export const MAX_SIMILAR_CALLS = 3
/** Turns in a row where one tool returned the same non-empty output before its next call is blocked. */
export const MAX_IDENTICAL_RESULTS = 4
const MAX_TURNS_KEPT = 16
/** Mutations answer with a fixed success line: their output carries no identity. */
const RESULT_BLIND_TOOLS = new Set(['edit', 'write'])
const LEVELS = ['block', 'steer', 'terminate', 'abort'] as const
const NUMBER = /\d+/g

export type StopLevel = (typeof LEVELS)[number]
export type LoopStop = { level: StopLevel; reason: string }
type ResultContent = readonly { type: string; text?: string; data?: string }[]

type CallState = 'pending' | 'blocked' | 'done'

interface CallRecord {
	callId: string
	tool: string
	inputHash: string
	inputShape: string
	state: CallState
	resultHash: string | undefined
	resultShape: string | undefined
}

interface TurnRecord {
	calls: CallRecord[]
}

interface Streak {
	turns: number
	blockedTurns: number
}

function digest(text: string): string {
	return createHash('sha256').update(text).digest('hex')
}

function stable(argument: unknown): unknown {
	if (Array.isArray(argument)) return argument.map(stable)
	if (argument && typeof argument === 'object')
		return Object.fromEntries(
			Object.entries(argument)
				.toSorted(([a], [b]) => a.localeCompare(b))
				.map(([key, inner]) => [key, stable(inner)]),
		)
	return argument
}

function inputText(input: unknown): string {
	return JSON.stringify(stable(input)) ?? ''
}

function shape(text: string): string {
	return digest(text.replace(NUMBER, '#'))
}

function resultText(content: ResultContent): string {
	return content
		.map(part =>
			part.type === 'text' ? (part.text ?? '') : (part.data ?? ''),
		)
		.join('\n')
		.trim()
}

/** The one non-empty output every completed call of a turn shares. */
function sharedOutput(
	done: readonly CallRecord[],
	key: 'resultHash' | 'resultShape' = 'resultHash',
): string | undefined {
	const [first, ...rest] = done
	const hash = first?.[key]
	if (!hash || rest.some(call => call[key] !== hash)) return undefined
	return hash
}

function levelFor(blockedTurns: number): StopLevel {
	return LEVELS[Math.min(blockedTurns, LEVELS.length - 1)] ?? 'abort'
}

function exitHint(level: StopLevel): string {
	if (level === 'abort')
		return 'The run is aborted; the human decides what happens next.'
	if (level === 'terminate')
		return 'The run ends after this batch: report the current state in your reply.'
	if (level === 'steer')
		return 'Second refusal in a row: the next identical call ends the run. State in one sentence which signal you are waiting for, then wait on it or do other work.'
	return 'Running it again yields nothing new. Wait on the real signal (a bash job wait, an async completion notice, a bounded readiness check on the port, pid or file the work produces), use a different tool, or end this turn and report the current state.'
}

export class RepeatGuard {
	private turns: TurnRecord[] = []

	clear(): void {
		this.turns = []
	}

	startTurn(): void {
		this.turns.push({ calls: [] })
		if (this.turns.length > MAX_TURNS_KEPT) this.turns.shift()
	}

	/** Record the call and decide before it runs; a blocked call still counts toward its streak. */
	decide(callId: string, tool: string, input: unknown): LoopStop | undefined {
		if (!this.turns.length) this.startTurn()
		const text = inputText(input)
		const hash = digest(text)
		const inputShape = shape(text)
		const identical = this.identicalCallStreak(tool, hash)
		const similar = this.similarCallStreak(tool, inputShape)
		const sameOutput = this.identicalResultStreak(tool)
		let streak: Streak | undefined
		let cause = ''
		if (identical.turns >= MAX_IDENTICAL_CALLS) {
			streak = identical
			cause = `${tool} was called with these exact arguments in each of the last ${identical.turns} turns`
		} else if (similar && similar.turns >= MAX_SIMILAR_CALLS) {
			streak = similar
			cause = `${tool} was called with the same arguments and got the same output, only numbers changing, in each of the last ${similar.turns} turns`
		} else if (sameOutput && sameOutput.turns >= MAX_IDENTICAL_RESULTS) {
			streak = sameOutput
			cause = `${tool} returned the same output in each of the last ${sameOutput.turns} turns`
		}
		this.turns.at(-1)?.calls.push({
			callId,
			tool,
			inputHash: hash,
			inputShape,
			state: streak ? 'blocked' : 'pending',
			resultHash: undefined,
			resultShape: undefined,
		})
		if (!streak) return undefined
		const level = levelFor(streak.blockedTurns)
		return {
			level,
			reason: `Repeated call blocked: ${cause}. ${exitHint(level)}`,
		}
	}

	complete(callId: string, content: ResultContent): void {
		for (const turn of this.turns.toReversed()) {
			const record = turn.calls.find(call => call.callId === callId)
			if (!record) continue
			if (record.state !== 'pending') return
			record.state = 'done'
			const text = resultText(content)
			record.resultHash = text ? digest(text) : undefined
			record.resultShape = text ? shape(text) : undefined
			return
		}
	}

	/** Completed turns, most recent first: the current turn is still being issued. */
	private previousTurns(): TurnRecord[] {
		return this.turns.slice(0, -1).toReversed()
	}

	/** Consecutive most-recent turns containing this exact call. */
	private identicalCallStreak(tool: string, hash: string): Streak {
		const streak: Streak = { turns: 0, blockedTurns: 0 }
		for (const turn of this.previousTurns()) {
			const matches = turn.calls.filter(
				call => call.tool === tool && call.inputHash === hash,
			)
			if (!matches.length) break
			streak.turns += 1
			if (matches.some(call => call.state === 'blocked'))
				streak.blockedTurns += 1
		}
		return streak
	}

	/** Consecutive most-recent turns calling this tool with the same masked arguments and getting the same masked non-empty output; a blocked match still extends the streak. */
	private similarCallStreak(
		tool: string,
		inputShape: string,
	): Streak | undefined {
		if (RESULT_BLIND_TOOLS.has(tool)) return undefined
		const streak: Streak = { turns: 0, blockedTurns: 0 }
		let expected: string | undefined
		for (const turn of this.previousTurns()) {
			const matches = turn.calls.filter(
				call => call.tool === tool && call.inputShape === inputShape,
			)
			if (!matches.length) break
			streak.turns += 1
			if (matches.some(call => call.state === 'blocked')) {
				streak.blockedTurns += 1
				continue
			}
			const output = sharedOutput(
				matches.filter(call => call.state === 'done'),
				'resultShape',
			)
			if (!output || (expected && output !== expected)) {
				streak.turns -= 1
				break
			}
			expected = output
		}
		return streak
	}

	/** Consecutive most-recent turns whose completed calls of this tool all returned one non-empty output; turns with only blocked or pending calls are transparent. */
	private identicalResultStreak(tool: string): Streak | undefined {
		if (RESULT_BLIND_TOOLS.has(tool)) return undefined
		const streak: Streak = { turns: 0, blockedTurns: 0 }
		let expected: string | undefined
		for (const turn of this.previousTurns()) {
			const calls = turn.calls.filter(call => call.tool === tool)
			if (!calls.length) break
			const done = calls.filter(call => call.state === 'done')
			const output = done.length ? sharedOutput(done) : undefined
			if (done.length && (!output || (expected && output !== expected)))
				break
			if (calls.some(call => call.state === 'blocked'))
				streak.blockedTurns += 1
			if (!output) continue
			expected = output
			streak.turns += 1
		}
		return streak
	}
}
