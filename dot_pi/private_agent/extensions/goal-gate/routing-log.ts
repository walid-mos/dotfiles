/** Per-session routing evidence: no raw prompt, no shared append target. */
import { createHash } from 'node:crypto'
import {
	appendFileSync,
	mkdirSync,
	readdirSync,
	rmSync,
	statSync,
} from 'node:fs'
import { join } from 'node:path'

import { getAgentDir } from '@earendil-works/pi-coding-agent'

import { LEDGER_RETENTION_MS } from './ledger.ts'

import type { ChoiceResult } from '../jev/client.ts'
import type { ScopeRoute, TaskRoute } from './routing.ts'

const DIR = 'routing'

export type RoutingRecord = {
	sessionId: string
	stage: 'request' | 'scope'
	prompt: string
	result: TaskRoute | ScopeRoute
	proposedScope?: ScopeRoute | undefined
	surfaceCount?: number | undefined
	decision?: ChoiceResult | undefined
	fallback?: 'missing-key' | 'request-failed' | undefined
}

export function recordRouting(record: RoutingRecord): void {
	const dir = join(getAgentDir(), 'jev', DIR)
	mkdirSync(dir, { recursive: true })
	const path = join(dir, `${record.sessionId}.jsonl`)
	appendFileSync(
		path,
		`${JSON.stringify({
			timestamp: new Date().toISOString(),
			sessionId: record.sessionId,
			stage: record.stage,
			promptHash: createHash('sha256')
				.update(record.prompt)
				.digest('hex'),
			result: record.result,
			proposedScope: record.proposedScope,
			surfaceCount: record.surfaceCount,
			choice: record.decision?.choice,
			confidence: record.decision?.confidence,
			probabilities: record.decision?.probabilities,
			model: record.decision?.model,
			inputTokens: record.decision?.inputTokens,
			latencyMs: record.decision?.latencyMs,
			fallback: record.fallback,
		})}\n`,
	)
}

/** The session file is never removed while it can still receive decisions. */
export function pruneRoutingLogs(activeSessionId: string): void {
	const dir = join(getAgentDir(), 'jev', DIR)
	const cutoff = Date.now() - LEDGER_RETENTION_MS
	for (const name of readdirSync(dir)) {
		if (name === `${activeSessionId}.jsonl` || !name.endsWith('.jsonl'))
			continue
		pruneOldFile(join(dir, name), cutoff)
	}
}

function pruneOldFile(path: string, cutoff: number): void {
	try {
		if (statSync(path).mtimeMs < cutoff) rmSync(path)
	} catch {
		// A concurrent session may have removed its own log.
	}
}
