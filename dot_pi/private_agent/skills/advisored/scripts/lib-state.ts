import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
	parseJsonRecord,
	readNumber,
	readRecord,
	readRecordList,
	readString,
	readStringList,
	readStrings,
} from './lib-json-fields.ts'

import type { JsonRecord } from './lib-json-fields.ts'

export type Backend = 'claude' | 'pi'

export type FingerprintScope = {
	repo: string
	paths: readonly string[]
}

export type EvidenceRecord = {
	path: string
	sha256: string
	fingerprintBefore: string
	fingerprintAfter: string
}

export type Round = {
	number: number
	checkpoint: string
	fingerprint: string
	scope: FingerprintScope
	verdict: string
	packetPath: string
	replyPath: string
	model: string
	costUsd: number | null
	evidenceCount: number
}

export type AdvisorState = {
	version: number
	backend: Backend
	requestedModel: string
	model: string
	effort: string | null
	cwd: string
	contractPath: string
	contractSha256: string
	requestPath: string
	ledgerPath: string
	evidence: EvidenceRecord[]
	rounds: Round[]
}

export const STATE_VERSION = 2
export const STATE_FILE = 'state.json'
export const JSON_INDENT = 2
const PRIVATE_FILE_MODE = 0o600

const STATE_STRING_KEYS = [
	'requestedModel',
	'model',
	'cwd',
	'contractPath',
	'contractSha256',
	'requestPath',
	'ledgerPath',
] as const
const ROUND_STRING_KEYS = [
	'checkpoint',
	'fingerprint',
	'verdict',
	'packetPath',
	'replyPath',
	'model',
] as const
const EVIDENCE_KEYS = [
	'path',
	'sha256',
	'fingerprintBefore',
	'fingerprintAfter',
] as const

export function sha256Hex(content: string | Buffer): string {
	return createHash('sha256').update(content).digest('hex')
}

export function statePath(stateDirectory: string): string {
	return join(stateDirectory, STATE_FILE)
}

export function writeState(stateDirectory: string, state: AdvisorState): void {
	writeFileSync(
		statePath(stateDirectory),
		`${JSON.stringify(state, null, JSON_INDENT)}\n`,
		{ mode: PRIVATE_FILE_MODE },
	)
}

export function lastRound(state: AdvisorState): Round | undefined {
	return state.rounds.at(-1)
}

function parseBackend(record: JsonRecord): Backend | undefined {
	const backend = readString(record, 'backend')
	if (backend === 'claude' || backend === 'pi') return backend
	return undefined
}

function parseScope(
	record: JsonRecord | undefined,
): FingerprintScope | undefined {
	if (!record) return undefined
	const repo = readString(record, 'repo')
	const paths = readStringList(record, 'paths')
	if (!repo || !paths) return undefined
	return { repo, paths }
}

function parseRound(record: JsonRecord): Round | undefined {
	const fields = readStrings(record, ROUND_STRING_KEYS)
	const number = readNumber(record, 'number')
	const evidenceCount = readNumber(record, 'evidenceCount')
	const scope = parseScope(readRecord(record, 'scope'))
	if (
		!fields ||
		typeof number !== 'number' ||
		typeof evidenceCount !== 'number' ||
		!scope
	)
		return undefined
	return {
		...fields,
		number,
		scope,
		evidenceCount,
		costUsd: readNumber(record, 'costUsd') ?? null,
	}
}

function parseList<Item>(
	record: JsonRecord,
	key: string,
	parseEntry: (entry: JsonRecord) => Item | undefined,
): Item[] | undefined {
	const entries = readRecordList(record, key)
	if (!entries) return undefined
	const items: Item[] = []
	for (const entry of entries) {
		const parsedEntry = parseEntry(entry)
		if (!parsedEntry) return undefined
		items.push(parsedEntry)
	}
	return items
}

function parseState(record: JsonRecord): AdvisorState | undefined {
	const backend = parseBackend(record)
	const fields = readStrings(record, STATE_STRING_KEYS)
	const rounds = parseList(record, 'rounds', parseRound)
	const evidence = parseList(record, 'evidence', entry =>
		readStrings(entry, EVIDENCE_KEYS),
	)
	const version = readNumber(record, 'version')
	if (
		version !== STATE_VERSION ||
		!backend ||
		!fields ||
		!rounds ||
		!evidence
	)
		return undefined
	return {
		...fields,
		version,
		backend,
		effort: readString(record, 'effort') ?? null,
		evidence,
		rounds,
	}
}

export function readState(stateDirectory: string): AdvisorState {
	const path = statePath(stateDirectory)
	const record = parseJsonRecord(readFileSync(path, 'utf8'))
	const state = record ? parseState(record) : undefined
	if (!state) {
		throw new Error(
			`State file ${path} does not match version ${STATE_VERSION} of this script; report lost continuity instead of recreating it.`,
		)
	}
	return state
}

export type ContractCheck =
	| { kind: 'intact' }
	| { kind: 'changed'; reason: string }

export function checkContract(state: AdvisorState): ContractCheck {
	let content: Buffer
	try {
		content = readFileSync(state.contractPath)
	} catch (error: unknown) {
		const reason = error instanceof Error ? error.message : String(error)
		return { kind: 'changed', reason: `contract unreadable: ${reason}` }
	}
	if (!content.length)
		return { kind: 'changed', reason: 'contract file is empty' }
	const digest = sha256Hex(content)
	if (digest !== state.contractSha256) {
		return {
			kind: 'changed',
			reason: `contract hash ${digest} differs from recorded ${state.contractSha256}`,
		}
	}
	return { kind: 'intact' }
}
