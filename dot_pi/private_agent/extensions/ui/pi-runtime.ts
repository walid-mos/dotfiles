/** Resolve the component classes used by the running CLI, not a second SDK copy. */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { reflectMember } from './pi-members.ts'

/** Pi release the display adapters were last audited against (DESIGN.md §10);
 * bumped by the pi-updated skill, never silently. */
export const AUDITED_PI_VERSION = '0.87.1'
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

export interface PiVersionDrift {
	auditedVersion: string
	runningVersion: string
	drifted: boolean
}

/** Compare the running CLI against the audited release without blocking installation;
 * the renderers extension surfaces `drifted` as a widget instead of refusing to load. */
export function detectPiDrift(runtime: unknown): PiVersionDrift {
	const version = reflectMember(runtime, 'VERSION')
	const runningVersion = typeof version === 'string' ? version : 'unknown'
	return {
		auditedVersion: AUDITED_PI_VERSION,
		runningVersion,
		drifted: runningVersion !== AUDITED_PI_VERSION,
	}
}

export async function loadPiRuntime(
	entry = process.argv[1] ?? '',
): Promise<unknown> {
	const root = findPackageRoot(entry)
	if (!root) return import('@earendil-works/pi-coding-agent')
	// Tests and SDK hosts without a recognized CLI use their own package copy.
	return import(pathToFileURL(join(root, BUNDLE_ENTRY)).href)
}
