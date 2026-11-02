import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runAuditProcess } from './lib-audit-process.ts'
import { reportLine } from './lib-hygiene.ts'
import { auditEvidence } from './lib-package-audit.ts'
import { findPackage } from './lib-pi-package.ts'
import { readRecord, vendoredPackages } from './lib-vendored-packages.ts'

import type { VendoredPackage } from './lib-vendored-packages.ts'

const SCRIPTS = dirname(fileURLToPath(import.meta.url))
const AGENT_DIRECTORY = dirname(dirname(dirname(SCRIPTS)))
const TIMEOUT_MS = 90_000
const PASSTHROUGH_ENVIRONMENT = [
	'PATH',
	'SystemRoot',
	'WINDIR',
	'LANG',
	'LC_ALL',
]

function auditEnvironment(
	hostRoot: string,
	directory: string,
): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = Object.fromEntries(
		PASSTHROUGH_ENVIRONMENT.flatMap(key =>
			process.env[key] ? [[key, process.env[key]]] : [],
		),
	)
	const home = join(directory, 'home')
	mkdirSync(home, { recursive: true })
	return {
		...environment,
		HOME: home,
		USERPROFILE: home,
		TMPDIR: directory,
		TMP: directory,
		TEMP: directory,
		PI_CODING_AGENT_DIR: join(directory, 'agent'),
		PI_AUDIT_HOST_ROOT: hostRoot,
		PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT: hostRoot,
	}
}

function runPackage(ofPackage: VendoredPackage, hostRoot: string): boolean {
	const directory = mkdtempSync(join(tmpdir(), 'pi-package-audit-'))
	const state = join(directory, 'state')
	mkdirSync(state)
	try {
		const execution = runAuditProcess(
			{
				arguments: [
					'--import',
					join(SCRIPTS, 'package-audit-loader.mjs'),
					join(SCRIPTS, 'package-audit-worker.ts'),
					ofPackage.auditEntry,
					hostRoot,
					state,
				],
				cwd: ofPackage.root,
				environment: auditEnvironment(hostRoot, state),
				timeoutMs: TIMEOUT_MS,
			},
			directory,
		)
		if (!execution.isPassed)
			throw new Error(
				execution.failure ??
					`exit ${execution.exitCode}, signal ${execution.signal ?? 'none'}`,
			)
		const serialized = readFileSync(join(state, 'result.json'), 'utf8')
		const evidence = auditEvidence(JSON.parse(serialized))
		for (const line of evidence) reportLine(`✓ ${ofPackage.name}: ${line}`)
		writeFileSync(join(directory, 'result.json'), serialized)
		reportLine(`  evidence: ${directory}`)
		return true
	} catch (error: unknown) {
		reportLine(
			`✗ ${ofPackage.name}: ${error instanceof Error ? error.message : String(error)}; evidence: ${directory}`,
		)
		return false
	} finally {
		rmSync(state, { recursive: true, force: true })
	}
}

try {
	const hostRoot = findPackage()
	reportLine(
		`installed Pi ${String(readRecord(join(hostRoot, 'package.json')).version)}: ${hostRoot}`,
	)
	const packages = vendoredPackages(AGENT_DIRECTORY)
	if (!packages.length)
		throw new Error(
			'No vendored packages discovered; refusing an empty audit',
		)
	const outcomes = packages.map(ofPackage => runPackage(ofPackage, hostRoot))
	if (outcomes.some(isPassed => !isPassed)) process.exitCode = 1
} catch (error: unknown) {
	reportLine(
		`✗ package audit: ${error instanceof Error ? error.message : String(error)}`,
	)
	process.exitCode = 1
}
