/** Locate the installed pi package from the `pi` CLI on PATH: follow the
 * binary (realpath) or its shim script up the directory tree to the package
 * directory that owns @earendil-works/pi-coding-agent's manifest. Shared by
 * the pi-updated audit scripts; abi-audit.ts carries an acknowledged copy
 * until its next audit pass. */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const PACKAGE_NAME = '@earendil-works/pi-coding-agent'

function isPackageRoot(directory: string): boolean {
	const manifestPath = join(directory, 'package.json')
	if (!existsSync(manifestPath)) return false
	const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
	return (
		typeof manifest === 'object' &&
		manifest !== null &&
		'name' in manifest &&
		manifest.name === PACKAGE_NAME
	)
}

/** Package root for a known CLI entry path, mirroring abi-audit.ts. */
export function packageRoot(entry: string): string | undefined {
	let directory = dirname(realpathSync(entry))
	while (dirname(directory) !== directory) {
		if (isPackageRoot(directory)) return directory
		directory = dirname(directory)
	}
	return undefined
}

function shimCliTarget(shim: string): string | undefined {
	const matches = readFileSync(shim, 'utf8').matchAll(
		/([^"\s]*)@earendil-works\/pi-coding-agent\/dist\/bundle\/cli\.js/g,
	)
	for (const match of matches) {
		const prefix = match[1] ?? ''
		if (prefix.includes('$basedir_win')) continue
		const target = resolve(
			dirname(shim),
			prefix.replaceAll('$basedir', dirname(shim)) +
				match[0].slice(prefix.length),
		)
		if (existsSync(target)) return target
	}
	return undefined
}

/** Package directory of the installed pi release. */
export function findPackage(): string {
	const binary = execFileSync('which', ['pi'], { encoding: 'utf8' }).trim()
	const root = packageRoot(binary) ?? packageRoot(shimCliTarget(binary) ?? '')
	if (!root)
		throw new Error(`no ${PACKAGE_NAME} package found above ${binary}`)
	return root
}
