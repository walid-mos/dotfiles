import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { parseJsonRecord, readString } from './lib-json-fields.ts'
import { describeFailure, runProcess } from './lib-process.ts'

import type { ReplyCheck } from './lib-backend-claude.ts'
import type { AdvisorState } from './lib-state.ts'

export const PI_DEFAULT_ADVISOR_MODEL = 'openai-codex/gpt-6.1-sol:high'
export const PI_SESSION_DIRECTORY = 'pi'

export const PI_ISOLATION = [
	'--no-extensions',
	'--no-mcp',
	'--no-skills',
	'--no-prompt-templates',
	'--no-context-files',
	'--no-approve',
]

const THINKING_LEVELS = new Set([
	'off',
	'minimal',
	'low',
	'medium',
	'high',
	'xhigh',
	'max',
])
const LOOKUP_TIMEOUT_MS = 120_000
const COLUMN_SEPARATOR = /\s{2,}/

export type ModelSelector = {
	identity: string
	thinking: string | null
}

export function splitThinkingSuffix(selector: string): ModelSelector {
	const separator = selector.lastIndexOf(':')
	if (separator === -1) return { identity: selector, thinking: null }
	const suffix = selector.slice(separator + 1)
	if (!THINKING_LEVELS.has(suffix))
		return { identity: selector, thinking: null }
	return { identity: selector.slice(0, separator), thinking: suffix }
}

export type ModelResolution =
	| { kind: 'resolved'; model: string }
	| { kind: 'ambiguous'; candidates: string[] }
	| { kind: 'missing' }
	| { kind: 'not-ready'; status: string }
	| { kind: 'failed'; reason: string }

function parseModelTable(stdout: string): string[] {
	return stdout
		.split('\n')
		.slice(1)
		.map(line => line.trim().split(COLUMN_SEPARATOR))
		.flatMap(([provider, model]) =>
			provider && model ? [`${provider}/${model}`] : [],
		)
}

function pickIdentity(
	candidates: string[],
	identity: string,
): string | undefined {
	const exact = candidates.find(candidate => candidate === identity)
	if (exact) return exact
	const [single] = candidates
	if (candidates.length !== 1) return undefined
	return single
}

export function resolvePiModel(selector: string, cwd: string): ModelResolution {
	const { identity, thinking } = splitThinkingSuffix(selector)
	const listing = runProcess({
		command: 'pi',
		arguments: [...PI_ISOLATION, '--list-models', identity],
		cwd,
		timeoutMs: LOOKUP_TIMEOUT_MS,
	})
	if (listing.exitCode !== 0) {
		return {
			kind: 'failed',
			reason: `pi --list-models ${describeFailure(listing)}: ${listing.stderr.trim()}`,
		}
	}
	const candidates = parseModelTable(listing.stdout)
	const resolvedIdentity = pickIdentity(candidates, identity)
	if (!resolvedIdentity) {
		return candidates.length
			? { kind: 'ambiguous', candidates }
			: { kind: 'missing' }
	}
	const auth = runProcess({
		command: 'pi',
		arguments: ['auth', 'check', '--model', resolvedIdentity],
		cwd,
		timeoutMs: LOOKUP_TIMEOUT_MS,
	})
	if (auth.exitCode !== 0) {
		return {
			kind: 'not-ready',
			status: auth.stdout.trim() || describeFailure(auth),
		}
	}
	return {
		kind: 'resolved',
		model: thinking ? `${resolvedIdentity}:${thinking}` : resolvedIdentity,
	}
}

export function piArguments(
	state: AdvisorState,
	stateDirectory: string,
	sessionId: string,
): string[] {
	return [
		'--print',
		'--model',
		state.model,
		'--no-tools',
		...PI_ISOLATION,
		'--system-prompt',
		state.contractPath,
		'--session-dir',
		join(stateDirectory, PI_SESSION_DIRECTORY),
		'--session-id',
		sessionId,
	]
}

function findSessionFile(
	stateDirectory: string,
	sessionId: string,
): string | undefined {
	const directory = join(stateDirectory, PI_SESSION_DIRECTORY)
	const name = readdirSync(directory).find(entry =>
		entry.endsWith(`_${sessionId}.jsonl`),
	)
	if (!name) return undefined
	return join(directory, name)
}

function sessionModels(sessionFile: string): string[] {
	return readFileSync(sessionFile, 'utf8')
		.split('\n')
		.filter(Boolean)
		.flatMap(line => {
			const entry = parseJsonRecord(line)
			if (!entry || readString(entry, 'type') !== 'model_change')
				return []
			return [
				`${readString(entry, 'provider') ?? '?'}/${readString(entry, 'modelId') ?? '?'}`,
			]
		})
}

export function checkPiReply(
	stdout: string,
	state: AdvisorState,
	stateDirectory: string,
	sessionId: string,
): ReplyCheck {
	const text = stdout.trim()
	if (!text)
		return {
			kind: 'rejected',
			reason: 'pi returned an empty answer',
			text: null,
		}
	const sessionFile = findSessionFile(stateDirectory, sessionId)
	if (!sessionFile) {
		return {
			kind: 'rejected',
			reason: `no session file ends with _${sessionId}.jsonl; the model cannot be confirmed`,
			text,
		}
	}
	const { identity } = splitThinkingSuffix(state.model)
	const foreignModels = sessionModels(sessionFile).filter(
		model => model !== identity,
	)
	if (foreignModels.length) {
		return {
			kind: 'rejected',
			reason: `session records other models: ${foreignModels.join(', ')}`,
			text,
		}
	}
	return {
		kind: 'accepted',
		reply: { text, model: identity, costUsd: null },
	}
}
