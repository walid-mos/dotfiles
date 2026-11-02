import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { computeFingerprint } from './lib-fingerprint.ts'
import { describeFailure, runProcess } from './lib-process.ts'
import { lastRound, readState, sha256Hex, writeState } from './lib-state.ts'

import type { EvidenceBlock } from './lib-packet.ts'
import type { AdvisorState, FingerprintScope } from './lib-state.ts'

export type RunCheckRequest = {
	stateDirectory: string
	scope: FingerprintScope
	command: readonly string[]
	timeoutMs: number
}

export type RunCheckSummary = {
	evidencePath: string
	outcome: string
	exitCode: number | null
	fingerprintBefore: string
	fingerprintAfter: string
}

export const EVIDENCE_DIRECTORY = 'evidence'
const PRIVATE_FILE_MODE = 0o600
const SEQUENCE_DIGITS = 3
const OUTPUT_KEEP_BYTES = 262_144
const UNSAFE_SLUG = /[^A-Za-z0-9-]/g

type RecordedRun = {
	command: readonly string[]
	cwd: string
	outcome: string
	startedAt: string
	finishedAt: string
	fingerprintBefore: string
	fingerprintAfter: string
	stdout: string
	stderr: string
}

function keepTail(output: string): string {
	const bytes = Buffer.byteLength(output)
	if (bytes <= OUTPUT_KEEP_BYTES) return output
	const omitted = bytes - OUTPUT_KEEP_BYTES
	const kept = Buffer.from(output).subarray(omitted).toString()
	return `[first ${omitted} bytes omitted]\n${kept}`
}

function renderEvidence(sequence: number, run: RecordedRun): string {
	return [
		`# Recorded check ${sequence}`,
		`command=${JSON.stringify(run.command)}`,
		`cwd=${run.cwd}`,
		`outcome=${run.outcome}`,
		`started=${run.startedAt}`,
		`finished=${run.finishedAt}`,
		`fingerprint-before=${run.fingerprintBefore}`,
		`fingerprint-after=${run.fingerprintAfter}`,
		'',
		'--- stdout ---',
		keepTail(run.stdout),
		'--- stderr ---',
		keepTail(run.stderr),
		'--- end ---',
		'',
	].join('\n')
}

function evidencePath(
	stateDirectory: string,
	sequence: number,
	executable: string,
): string {
	const slug = basename(executable).replaceAll(UNSAFE_SLUG, '-')
	const prefix = String(sequence).padStart(SEQUENCE_DIGITS, '0')
	return join(stateDirectory, EVIDENCE_DIRECTORY, `${prefix}-${slug}.md`)
}

export function runCheck(request: RunCheckRequest): RunCheckSummary {
	const [executable, ...executableArguments] = request.command
	if (!executable) throw new Error('run-check needs a command after --')
	const state = readState(request.stateDirectory)
	const fingerprintBefore = computeFingerprint(request.scope).value
	const startedAt = new Date().toISOString()
	const run = runProcess({
		command: executable,
		arguments: executableArguments,
		cwd: state.cwd,
		timeoutMs: request.timeoutMs,
	})
	const finishedAt = new Date().toISOString()
	const fingerprintAfter = computeFingerprint(request.scope).value
	const sequence = state.evidence.length + 1
	const path = evidencePath(request.stateDirectory, sequence, executable)
	const outcome = describeFailure(run)
	const text = renderEvidence(sequence, {
		command: request.command,
		cwd: state.cwd,
		outcome,
		startedAt,
		finishedAt,
		fingerprintBefore,
		fingerprintAfter,
		stdout: run.stdout,
		stderr: run.stderr,
	})
	writeFileSync(path, text, { mode: PRIVATE_FILE_MODE })
	writeState(request.stateDirectory, {
		...state,
		evidence: [
			...state.evidence,
			{
				path,
				sha256: sha256Hex(text),
				fingerprintBefore,
				fingerprintAfter,
			},
		],
	})
	return {
		evidencePath: path,
		outcome,
		exitCode: run.exitCode,
		fingerprintBefore,
		fingerprintAfter,
	}
}

export type EvidenceGathering =
	| { kind: 'gathered'; blocks: EvidenceBlock[] }
	| { kind: 'tampered'; reason: string }

export function gatherEvidence(state: AdvisorState): EvidenceGathering {
	const sentCount = lastRound(state)?.evidenceCount ?? 0
	const blocks: EvidenceBlock[] = []
	for (const [index, record] of state.evidence.entries()) {
		const content = readFileSync(record.path, 'utf8')
		if (sha256Hex(content) !== record.sha256) {
			return {
				kind: 'tampered',
				reason: `${record.path} changed since run-check recorded it; rerun the check instead of editing evidence`,
			}
		}
		if (index >= sentCount)
			blocks.push({
				name: basename(record.path),
				sha256: record.sha256,
				content,
			})
	}
	return { kind: 'gathered', blocks }
}
