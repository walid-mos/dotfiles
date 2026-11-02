import {
	chmodSync,
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
	CLAUDE_DEFAULT_EFFORT,
	CLAUDE_DEFAULT_MODEL,
} from './lib-backend-claude.ts'
import {
	PI_DEFAULT_ADVISOR_MODEL,
	PI_SESSION_DIRECTORY,
	resolvePiModel,
} from './lib-backend-pi.ts'
import { EVIDENCE_DIRECTORY } from './lib-evidence.ts'
import { PACKETS_DIRECTORY, REPLIES_DIRECTORY } from './lib-round-files.ts'
import { STATE_VERSION, sha256Hex, writeState } from './lib-state.ts'

import type { ModelResolution } from './lib-backend-pi.ts'
import type { AdvisorState, Backend } from './lib-state.ts'

const SKILL_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONTRACT_SOURCE = join(SKILL_DIRECTORY, 'advisor.md')
const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600

export type Implementer = 'claude-code' | 'other'

export type InitRequest = {
	backend: Backend | undefined
	model: string | undefined
	effort: string | undefined
	cwd: string
	requestPath: string
	implementer: Implementer
}

export type InitSummary = {
	stateDirectory: string
	backend: Backend
	model: string
	contractSha256: string
}

const LEDGER_SEED = `# Advisor ledger

Items are copied verbatim from advisor replies. The advisor closes or reclassifies; the implementer records responses and evidence.

## Done criteria

| ID | Criterion | Evidence | Status | Origin round |
| --- | --- | --- | --- | --- |

## Items

| ID | Kind | Severity | Closure criterion | Status | Origin round | Implementer response | Evidence | Closing round |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

## Routes tried and decisions

`

function describeResolution(
	resolution: ModelResolution,
	selector: string,
): string {
	switch (resolution.kind) {
		case 'resolved':
			return resolution.model
		case 'ambiguous':
			return `${selector} matches several models; pass one exact id: ${resolution.candidates.join(', ')}`
		case 'missing':
			return `${selector} matches no model in pi --list-models`
		case 'not-ready':
			return `credentials for ${selector} are ${resolution.status}; run pi auth for that provider first`
		case 'failed':
			return resolution.reason
	}
}

function chooseBackend(request: InitRequest): Backend {
	if (request.backend) return request.backend
	if (request.model) return 'pi'
	return request.implementer === 'claude-code' ? 'pi' : 'claude'
}

function resolveModel(request: InitRequest, backend: Backend): string {
	if (backend === 'claude') return request.model ?? CLAUDE_DEFAULT_MODEL
	const selector = request.model ?? PI_DEFAULT_ADVISOR_MODEL
	const resolution = resolvePiModel(selector, request.cwd)
	if (resolution.kind !== 'resolved')
		throw new Error(describeResolution(resolution, selector))
	return resolution.model
}

function createStateDirectory(backend: Backend): string {
	const stateDirectory = mkdtempSync(join(tmpdir(), 'advisored-'))
	chmodSync(stateDirectory, PRIVATE_DIRECTORY_MODE)
	const children = [PACKETS_DIRECTORY, REPLIES_DIRECTORY, EVIDENCE_DIRECTORY]
	if (backend === 'pi') children.push(PI_SESSION_DIRECTORY)
	for (const child of children)
		mkdirSync(join(stateDirectory, child), { mode: PRIVATE_DIRECTORY_MODE })
	return stateDirectory
}

function freezeContract(stateDirectory: string): {
	contractPath: string
	contractSha256: string
} {
	const contractPath = join(stateDirectory, 'advisor.md')
	const content = readFileSync(CONTRACT_SOURCE)
	if (!content.length)
		throw new Error(`${CONTRACT_SOURCE} is empty; the skill is damaged.`)
	writeFileSync(contractPath, content, { mode: PRIVATE_FILE_MODE })
	return { contractPath, contractSha256: sha256Hex(content) }
}

export function initTask(request: InitRequest): InitSummary {
	const backend = chooseBackend(request)
	const model = resolveModel(request, backend)
	const stateDirectory = createStateDirectory(backend)
	const contract = freezeContract(stateDirectory)
	const requestPath = join(stateDirectory, 'request.md')
	copyFileSync(request.requestPath, requestPath)
	chmodSync(requestPath, PRIVATE_FILE_MODE)
	const ledgerPath = join(stateDirectory, 'ledger.md')
	writeFileSync(ledgerPath, LEDGER_SEED, { mode: PRIVATE_FILE_MODE })
	const state: AdvisorState = {
		version: STATE_VERSION,
		backend,
		requestedModel: request.model ?? model,
		model,
		effort:
			backend === 'claude'
				? (request.effort ?? CLAUDE_DEFAULT_EFFORT)
				: null,
		cwd: resolve(request.cwd),
		...contract,
		requestPath,
		ledgerPath,
		evidence: [],
		rounds: [],
	}
	writeState(stateDirectory, state)
	return {
		stateDirectory,
		backend,
		model,
		contractSha256: contract.contractSha256,
	}
}
