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

import { readFileSync } from 'node:fs'

/**
 * What the hook found when it claimed the armed handoff:
 * - `idle`    - nothing armed: this compaction is not ours to steer
 * - `text`    - the handoff's text (outer whitespace trimmed), to be used as
 *               this compaction's summary - never pi's own, and never reworded
 * - `missing` - armed but unreadable: there is nothing to put in its place
 */
export type SummaryClaim =
	| { type: 'idle' }
	| { type: 'text'; text: string }
	| { type: 'missing'; path: string }

/** At most one handoff is armed at a time: the one the settle decision named. */
export class HandoffSummary {
	private armed: string | undefined

	/** Declare the handoff the next compaction must use as its summary. */
	arm(path: string): void {
		this.armed = path
	}

	/** Drop the arming: the compaction that would have used it never happened. */
	disarm(): void {
		this.armed = undefined
	}

	/** Claim the armed handoff, clearing it whether or not it could be read. */
	claim(): SummaryClaim {
		const path = this.armed
		this.armed = undefined
		if (!path) return { type: 'idle' }
		let text: string
		try {
			text = readFileSync(path, 'utf8').trim()
		} catch {
			return { type: 'missing', path }
		}
		if (!text) return { type: 'missing', path }
		return { type: 'text', text }
	}
}
