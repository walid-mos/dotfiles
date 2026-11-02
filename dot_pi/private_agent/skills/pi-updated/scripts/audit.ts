import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runAuditProcess } from './lib-audit-process.ts'
import { reportLine } from './lib-hygiene.ts'
import { findPackage } from './lib-pi-package.ts'
import { readRecord } from './lib-vendored-packages.ts'

const SCRIPTS = dirname(fileURLToPath(import.meta.url))
const AGENT_DIRECTORY = dirname(dirname(dirname(SCRIPTS)))
const CHECKS = [
	'extension-audit.ts',
	'hygiene-audit.ts',
	'package-audit.ts',
	'abi-audit.ts',
]
const TIMEOUT_MS = 300_000
const JSON_INDENT = 2

try {
	const hostRoot = findPackage()
	const directory = mkdtempSync(join(tmpdir(), 'pi-update-audit-'))
	const outcomes = CHECKS.map(check => {
		const execution = runAuditProcess(
			{
				arguments: [join(SCRIPTS, check)],
				cwd: AGENT_DIRECTORY,
				environment: { ...process.env, PI_AUDIT_HOST_ROOT: hostRoot },
				timeoutMs: TIMEOUT_MS,
			},
			join(directory, check),
		)
		reportLine(
			`${execution.isPassed ? '✓' : '✗'} ${check}: exit ${execution.exitCode}, signal ${execution.signal ?? 'none'}; ${execution.log}`,
		)
		return { check, execution }
	})
	const isPassed = outcomes.every(outcome => outcome.execution.isPassed)
	const report = join(directory, 'report.json')
	writeFileSync(
		report,
		JSON.stringify(
			{
				hostRoot,
				version: readRecord(join(hostRoot, 'package.json')).version,
				isPassed,
				outcomes,
			},
			null,
			JSON_INDENT,
		),
	)
	reportLine(
		`${isPassed ? 'Compatibility checks passed' : 'Compatibility checks failed; do not mark this Pi release audited'}. Report: ${report}`,
	)
	if (!isPassed) process.exitCode = 1
} catch (error: unknown) {
	reportLine(
		`✗ update audit: ${error instanceof Error ? error.message : String(error)}`,
	)
	process.exitCode = 1
}
