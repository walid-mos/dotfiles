/** Print the installed pi package's CHANGELOG.md sections between two versions
 * (default: AUDITED_PI_VERSION exclusive → installed version inclusive). Run
 * from ~/.pi/agent:
 *   node skills/pi-updated/scripts/changelog-diff.ts
 * Optional args: <fromVersion> <toVersion>. Exit 1 when a wanted section is
 * missing from the installed changelog (fetch the older tarball then). */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { AUDITED_PI_VERSION } from '#lib/ui/pi-runtime.ts'

import { findPackage } from './lib-pi-package.ts'

interface Section {
	version: string
	text: string
}

/** Split a CHANGELOG.md into `## [version] …` sections, preamble dropped. */
function parseSections(changelog: string): Section[] {
	const sections: Section[] = []
	let current: Section | undefined
	const flush = (): void => {
		if (current) sections.push(current)
		current = undefined
	}
	for (const line of changelog.split('\n')) {
		const header = /^## \[([^\]]+)\]/.exec(line)
		if (header) {
			flush()
			current = { version: header[1] ?? '', text: `${line}\n` }
			continue
		}
		if (current) current.text += `${line}\n`
	}
	flush()
	return sections
}

/** Numeric-dot version comparison; prerelease suffixes are ignored. */
function versionParts(version: string): number[] {
	return (
		version
			.split('-')[0]
			?.split('.')
			.map(part => Number.parseInt(part, 10) || 0) ?? []
	)
}

function compareVersions(a: string, b: string): number {
	const pa = versionParts(a)
	const pb = versionParts(b)
	for (let index = 0; index < Math.max(pa.length, pb.length); index++) {
		const delta = (pa[index] ?? 0) - (pb[index] ?? 0)
		if (delta !== 0) return delta
	}
	return 0
}

async function main(): Promise<number> {
	const fromVersionArg = 2
	const toVersionArg = 3
	const fromVersion = process.argv[fromVersionArg] ?? AUDITED_PI_VERSION
	const root = findPackage()
	const installedVersion: string = JSON.parse(
		readFileSync(join(root, 'package.json'), 'utf8'),
	).version
	const toVersion = process.argv[toVersionArg] ?? installedVersion
	process.stdout.write(
		`installed pi: ${installedVersion}\nrange: > ${fromVersion} .. <= ${toVersion}\n\n`,
	)

	const changelogPath = join(root, 'CHANGELOG.md')
	if (!existsSync(changelogPath)) {
		process.stdout.write(
			`✗ no CHANGELOG.md in ${root} - npm pack the package and read it there.\n`,
		)
		return 1
	}
	const sections = parseSections(readFileSync(changelogPath, 'utf8'))
	if (
		!sections.some(
			section => compareVersions(section.version, fromVersion) === 0,
		)
	) {
		process.stdout.write(
			`✗ audited version ${fromVersion} is missing from the installed changelog - fetch the older tarball and inspect the omitted interval.\n`,
		)
		return 1
	}
	const wanted = sections.filter(
		section =>
			compareVersions(section.version, fromVersion) > 0 &&
			compareVersions(section.version, toVersion) <= 0,
	)
	if (!wanted.length) {
		process.stdout.write(
			`✗ no changelog sections between ${fromVersion} and ${toVersion} - fetch the older tarball (npm pack @${fromVersion}) and read its CHANGELOG.md.\n`,
		)
		return 1
	}
	for (const section of wanted.toSorted((a, b) =>
		compareVersions(b.version, a.version),
	))
		process.stdout.write(section.text)
	return 0
}

process.exitCode = await main()
