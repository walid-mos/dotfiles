/**
 * context-budget - persistence for the chosen ceiling.
 *
 * The ceiling is user state owned by this extension, so it lives in its own
 * file under the agent directory and never in `settings.json` (pi-managed,
 * rewritten by the app) nor in a session entry (lost on the next session).
 * Read once per session, written only by `/context-budget`.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_HANDOFF_TOKENS } from './budget.ts'

import type { Ceiling } from './budget.ts'

export const STATE_FILE = 'context-budget.json'

/** The only shape this file stores; anything else falls back to the default. */
export function readCeiling(agentDir: string): Ceiling {
	try {
		const parsed: unknown = JSON.parse(
			readFileSync(join(agentDir, STATE_FILE), 'utf8'),
		)
		if (typeof parsed !== 'object' || parsed === null) {
			return DEFAULT_HANDOFF_TOKENS
		}
		const stored = Reflect.get(parsed, 'handoffTokens')
		if (stored === 'off') return 'off'
		if (typeof stored === 'number' && Number.isFinite(stored)) return stored
	} catch {
		// Absent or unreadable: fall through to the default.
	}
	return DEFAULT_HANDOFF_TOKENS
}

export function writeCeiling(agentDir: string, ceiling: Ceiling): void {
	mkdirSync(agentDir, { recursive: true })
	writeFileSync(
		join(agentDir, STATE_FILE),
		`${JSON.stringify({ handoffTokens: ceiling }, null, '\t')}\n`,
	)
}
