import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { reportLine } from './lib-hygiene.ts'
import { auditEvidence } from './lib-package-audit.ts'

import type { PackageAuditContext } from './lib-package-audit.ts'

function isAuditModule(
	module: unknown,
): module is { audit: (context: PackageAuditContext) => Promise<unknown> } {
	return (
		typeof module === 'object' &&
		module !== null &&
		'audit' in module &&
		typeof module.audit === 'function'
	)
}

async function main(): Promise<void> {
	const [, , entry, hostRoot, temporaryDirectory] = process.argv
	if (!entry || !hostRoot || !temporaryDirectory)
		throw new Error(
			'Expected audit entry, installed Pi root, and temporary directory',
		)
	const loaded: unknown = await import(pathToFileURL(entry).href)
	if (!isAuditModule(loaded))
		throw new Error(`${entry} must export an async audit(context) function`)
	const evidence = auditEvidence(
		await loaded.audit({ hostRoot, temporaryDirectory }),
	)
	writeFileSync(
		join(temporaryDirectory, 'result.json'),
		JSON.stringify(evidence),
	)
}

try {
	await main()
} catch (error: unknown) {
	reportLine(
		error instanceof Error ? (error.stack ?? error.message) : String(error),
	)
	process.exitCode = 1
}
