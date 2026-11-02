import { parseArgs } from 'node:util'

import { runCheck } from './lib-evidence.ts'
import { computeFingerprint } from './lib-fingerprint.ts'
import { initTask } from './lib-init.ts'
import { sendPacket } from './lib-send.ts'
import { checkContract, readState } from './lib-state.ts'
import { verifyDelivery } from './lib-verify.ts'

import type { Implementer } from './lib-init.ts'
import type { SendOutcome } from './lib-send.ts'
import type { Backend, FingerprintScope } from './lib-state.ts'

const EXIT_REFUSED = 1
const EXIT_PRECONDITION = 2
const EXIT_PROCESS = 3
const SEND_TIMEOUT_MS = 1_200_000
const CHECK_TIMEOUT_MS = 600_000
const JSON_INDENT = 2
const ARGUMENTS_START = 2

const USAGE = `Usage: node advisor.ts <command> [options]

  init --request <file> [--backend claude|pi] [--model <selector>] [--effort <level>] [--cwd <dir>]
      Create the private task directory, freeze the advisor contract, choose and pin the advisor.
  fingerprint [--repo <dir>] [--path <file>]... [--manifest]
      Print the fingerprint of HEAD plus every changed path (and explicit --path files).
  run-check <state_dir> [--repo <dir>] [--path <file>]... [--timeout-ms <n>] -- <command...>
      Run a check in the task cwd and record its output as evidence for the next packet.
  send <state_dir> --checkpoint <LABEL> --body <file> [--repo <dir>] [--path <file>]... [--timeout-ms <n>]
      Fingerprint the tree, assemble the packet, launch the advisor, validate the reply.
  verify <state_dir>
      Recompute the fingerprint with the READY round's scope and compare the values.
  status <state_dir>
      Print the recorded rounds, evidence count, last verdict and the contract check.

Exit codes: 0 accepted, 1 reply rejected or delivery not approved, 2 precondition or usage error, 3 advisor process failed.
`

const SCOPE_OPTIONS = {
	repo: { type: 'string' },
	path: { type: 'string', multiple: true },
} as const

type ScopeValues = { repo?: string | undefined; path?: string[] | undefined }

function readScope(values: ScopeValues): FingerprintScope {
	return { repo: values.repo ?? process.cwd(), paths: values.path ?? [] }
}

function emit(payload: unknown): void {
	process.stdout.write(`${JSON.stringify(payload, null, JSON_INDENT)}\n`)
}

function warn(message: string): void {
	process.stderr.write(`${message}\n`)
}

function requireOption(name: string, optionValue: string | undefined): string {
	if (!optionValue) throw new Error(`--${name} is required`)
	return optionValue
}

function requireStateDirectory(command: string, positionals: string[]): string {
	const [stateDirectory] = positionals
	if (!stateDirectory)
		throw new Error(
			`${command} needs the state directory as first argument`,
		)
	return stateDirectory
}

function parseBackend(candidate: string | undefined): Backend | undefined {
	if (!candidate) return undefined
	if (candidate === 'claude' || candidate === 'pi') return candidate
	throw new Error('--backend must be claude or pi')
}

function detectImplementer(): Implementer {
	return process.env.CLAUDECODE ? 'claude-code' : 'other'
}

function runInit(rest: string[]): void {
	const { values } = parseArgs({
		args: rest,
		options: {
			backend: { type: 'string' },
			model: { type: 'string' },
			effort: { type: 'string' },
			cwd: { type: 'string' },
			request: { type: 'string' },
		},
	})
	emit(
		initTask({
			backend: parseBackend(values.backend),
			model: values.model,
			effort: values.effort,
			cwd: values.cwd ?? process.cwd(),
			requestPath: requireOption('request', values.request),
			implementer: detectImplementer(),
		}),
	)
}

function runFingerprint(rest: string[]): void {
	const { values } = parseArgs({
		args: rest,
		options: { ...SCOPE_OPTIONS, manifest: { type: 'boolean' } },
	})
	const fingerprint = computeFingerprint(readScope(values))
	emit(values.manifest ? fingerprint : { fingerprint: fingerprint.value })
}

function runRunCheck(rest: string[]): void {
	const { values, positionals } = parseArgs({
		args: rest,
		allowPositionals: true,
		options: { ...SCOPE_OPTIONS, 'timeout-ms': { type: 'string' } },
	})
	const [stateDirectory, ...command] = positionals
	if (!stateDirectory)
		throw new Error('run-check needs the state directory as first argument')
	emit(
		runCheck({
			stateDirectory,
			scope: readScope(values),
			command,
			timeoutMs: Number(values['timeout-ms'] ?? CHECK_TIMEOUT_MS),
		}),
	)
}

const SEND_EXIT_CODES: Record<SendOutcome['kind'], number> = {
	accepted: 0,
	rejected: EXIT_REFUSED,
	precondition: EXIT_PRECONDITION,
	process: EXIT_PROCESS,
}

function runSend(rest: string[]): void {
	const { values, positionals } = parseArgs({
		args: rest,
		allowPositionals: true,
		options: {
			...SCOPE_OPTIONS,
			checkpoint: { type: 'string' },
			body: { type: 'string' },
			'timeout-ms': { type: 'string' },
		},
	})
	const outcome = sendPacket({
		stateDirectory: requireStateDirectory('send', positionals),
		checkpoint: requireOption('checkpoint', values.checkpoint),
		scope: readScope(values),
		bodyPath: requireOption('body', values.body),
		timeoutMs: Number(values['timeout-ms'] ?? SEND_TIMEOUT_MS),
	})
	emit(outcome)
	process.exitCode = SEND_EXIT_CODES[outcome.kind]
}

function runVerify(rest: string[]): void {
	const { positionals } = parseArgs({
		args: rest,
		allowPositionals: true,
		options: {},
	})
	const outcome = verifyDelivery(requireStateDirectory('verify', positionals))
	emit(outcome)
	process.exitCode = outcome.isApproved ? 0 : EXIT_REFUSED
}

function runStatus(rest: string[]): void {
	const state = readState(requireStateDirectory('status', rest))
	const lastRound = state.rounds.at(-1)
	emit({
		backend: state.backend,
		model: state.model,
		contract: checkContract(state),
		evidenceRecorded: state.evidence.length,
		rounds: state.rounds.map(round => ({
			number: round.number,
			checkpoint: round.checkpoint,
			verdict: round.verdict,
			fingerprint: round.fingerprint,
			costUsd: round.costUsd,
		})),
		lastVerdict: lastRound?.verdict ?? null,
		lastFingerprint: lastRound?.fingerprint ?? null,
		ledgerPath: state.ledgerPath,
	})
}

const COMMANDS: Record<string, (rest: string[]) => void> = {
	init: runInit,
	fingerprint: runFingerprint,
	'run-check': runRunCheck,
	send: runSend,
	verify: runVerify,
	status: runStatus,
}

const [command, ...rest] = process.argv.slice(ARGUMENTS_START)
const handler = command ? COMMANDS[command] : undefined
if (handler) {
	try {
		handler(rest)
	} catch (error: unknown) {
		warn(error instanceof Error ? error.message : String(error))
		process.exitCode = EXIT_PRECONDITION
	}
} else {
	warn(USAGE)
	process.exitCode = EXIT_PRECONDITION
}
