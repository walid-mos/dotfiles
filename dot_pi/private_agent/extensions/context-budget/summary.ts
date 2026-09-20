/**
 * context-budget - the handoff a compaction must use as its summary.
 *
 * The ceiling does not start a new session: it compacts this one. Compaction is
 * the reset this extension wants - the conversation leaves the prompt while the
 * transcript, the model and the thinking level stay - but what replaces that
 * conversation must be the handoff the agent wrote while it still held the
 * whole picture, never pi's own summary of the context it just discarded. pi's
 * summary is one generic pass over an exhausted prompt; the handoff is a
 * curated document.
 *
 * So the settle decision arms one handoff file, `ctx.compact()` fires
 * `session_before_compact`, and the hook claims that file - once - as the
 * summary. Claiming disarms, so a `/compact` the user runs later falls back to
 * pi's own summary instead of silently reusing a stale handoff.
 */

import { readFileSync, statSync } from 'node:fs'

/**
 * What the hook found when it claimed the armed handoff:
 * - `idle`      - nothing armed: this compaction is not ours to steer
 * - `text`      - the handoff's text (outer whitespace trimmed), to be used as
 *                 this compaction's summary - never pi's own, and never reworded;
 *                 `modifiedAt` is when the file was written, the floor the kept
 *                 boundary must respect (entries written after it exist nowhere
 *                 else)
 * - `missing`   - armed but unreadable: there is nothing to put in its place
 */
export type SummaryClaim =
	| { type: 'idle' }
	| { type: 'text'; text: string; modifiedAt: number | undefined }
	| { type: 'missing'; path: string }

/** At most one handoff is armed at a time: the one the settle decision named. */
export class HandoffSummary {
	private armed: string | undefined
	/** Set once this cycle steered a compaction at a handoff; survives claim. */
	private cycleUsed = false

	/** Declare the handoff the next compaction must use as its summary. */
	arm(path: string): void {
		this.armed = path
		this.cycleUsed = true
	}

	/** Drop the arming: the compaction that would have used it never happened. */
	disarm(): void {
		this.armed = undefined
	}

	/** The handoff currently armed, if any: what the next compaction claims. */
	get armedPath(): string | undefined {
		return this.armed
	}

	/**
	 * Whether this cycle already armed a handoff for a compaction - even one
	 * that was then claimed or failed. A later pi-initiated compaction in the
	 * same cycle must not silently re-arm from the file on its own.
	 */
	get cycleConsumed(): boolean {
		return this.cycleUsed
	}

	/** Start a new cycle: the next arm is the cycle's first. */
	reset(): void {
		this.cycleUsed = false
	}

	/** Claim the armed handoff, clearing it whether or not it could be read. */
	claim(): SummaryClaim {
		const path = this.armed
		this.armed = undefined
		if (!path) return { type: 'idle' }
		try {
			const text = readFileSync(path, 'utf8').trim()
			if (!text) return { type: 'missing', path }
			let modifiedAt: number | undefined
			try {
				modifiedAt = statSync(path).mtimeMs
			} catch {
				// The text was read, so the file exists: an unreadable stat only
				// means the boundary picker gets no floor to respect.
			}
			return { type: 'text', text, modifiedAt }
		} catch {
			return { type: 'missing', path }
		}
	}
}

/** A bare `next step` heading: it must end right after the words, so prose
 * like "the next step is to run the tests" cannot match. */
const NEXT_STEP_HEADING =
	/^\s*(?:#{1,6}|[-*+]|\*{1,2})?\s*(?:exact\s+)?next\s+step\b\s*:?\s*(?:\*{1,2})?\s*$/i

/** First line under the heading that says there is nothing left to run. */
const TERMINAL_STEP =
	/^(?:nothing|none|no next step|done|complete[d]?|finished|blocked|task complete)\b/i

/**
 * Whether the handoff's next-step section closes the work. The post-compaction
 * continuation is skipped then: a handoff that says nothing is left should not
 * buy another model call, and goal-gate resumes anything it wrongly closed at
 * the next settle or human prompt. Strict on purpose: a section that is not
 * recognisably terminal keeps the continuation.
 */
export function handoffNextStepClosed(text: string): boolean {
	const lines = text.split('\n')
	const heading = lines.findIndex(line => NEXT_STEP_HEADING.test(line.trim()))
	if (heading === -1) return false
	for (let i = heading + 1; i < lines.length; i++) {
		const line = lines[i]?.trim()
		if (!line) continue
		if (line.startsWith('#')) return false
		return TERMINAL_STEP.test(line)
	}
	return false
}

/** `handoffNextStepClosed` on the file's text; an unreadable file is open. */
export function handoffClosedOnDisk(path: string): boolean {
	try {
		return handoffNextStepClosed(readFileSync(path, 'utf8'))
	} catch {
		return false
	}
}
