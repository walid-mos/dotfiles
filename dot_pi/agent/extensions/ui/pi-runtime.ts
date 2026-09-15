/** Resolve the component classes used by the running CLI, not a second SDK copy. */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { reflectMember } from './pi-members.ts'

const SUPPORTED_PI_VERSION = '0.85.1'
const PACKAGE_NAME = '@earendil-works/pi-coding-agent'
const BUNDLE_ENTRY = 'dist/bundle/index.js'

function isRuntimeRoot(directory: string): boolean {
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

function findPackageRoot(entry: string): string {
	if (!entry || !existsSync(entry)) return ''
	let directory = dirname(realpathSync(entry))
	while (dirname(directory) !== directory) {
		if (isRuntimeRoot(directory)) return directory
		directory = dirname(directory)
	}
	return ''
}

export function assertSupportedPi(runtime: unknown, owner: string): void {
	const version = reflectMember(runtime, 'VERSION')
	if (version !== SUPPORTED_PI_VERSION)
		throw new Error(
			`${owner} supports Pi ${SUPPORTED_PI_VERSION}; found ${String(version)}. Re-audit the display adapters before upgrading.`,
		)
}

export async function loadPiRuntime(
	entry = process.argv[1] ?? '',
): Promise<unknown> {
	const root = findPackageRoot(entry)
	if (root) return import(pathToFileURL(join(root, BUNDLE_ENTRY)).href)
	// Tests and SDK hosts without a recognized CLI use their own package copy.
	return import('@earendil-works/pi-coding-agent')
}
