/** Print the installed pi package's CHANGELOG.md sections between two versions
 * (default: AUDITED_PI_VERSION exclusive → installed version inclusive). Run
 * from ~/.pi/agent:
 *   node --experimental-transform-types skills/pi-updated/scripts/changelog-diff.ts
 * Optional args: <fromVersion> <toVersion>. Exit 1 when a wanted section is
 * missing from the installed changelog (fetch the older tarball then). */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { AUDITED_PI_VERSION } from '../../../extensions/ui/pi-runtime.ts'

const PACKAGE_NAME = '@earendil-works/pi-coding-agent'

interface Section {
	version: string
	text: string
}

/** Package root for a known CLI entry path, or undefined when none sits above it. */
function packageRoot(entry: string): string | undefined {
	let directory = dirname(realpathSync(entry))
	while (dirname(directory) !== directory) {
		if (isPackageRoot(directory)) return directory
		directory = dirname(directory)
	}
	return undefined
}

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

/** The CLI entry a launcher shim execs, with `$basedir` resolved to the shim directory;
 * the Windows variant (`$basedir_win`) lines are skipped. */
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

/** Resolve the installed package root from the `pi` binary on PATH. */
function findPackageRoot(): string {
	const binary = execFileSync('which', ['pi'], { encoding: 'utf8' }).trim()
	const root = packageRoot(binary) ?? packageRoot(shimCliTarget(binary) ?? '')
	if (!root)
		throw new Error(`no ${PACKAGE_NAME} package found above ${binary}`)
	return root
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

/** Numeric-dot version comparison; prerelease tags sort below the plain release. */
function compareVersions(a: string, b: string): number {
	const parts = (version: string): number[] =>
		version
			.split('-')[0]
			?.split('.')
			.map(part => Number.parseInt(part, 10) || 0) ?? []
	const pa = parts(a)
	const pb = parts(b)
	for (let index = 0; index < Math.max(pa.length, pb.length); index++) {
		const delta = (pa[index] ?? 0) - (pb[index] ?? 0)
		if (delta !== 0) return delta
	}
	return 0
}

async function main(): Promise<number> {
	const fromVersion = process.argv[2] ?? AUDITED_PI_VERSION
	const root = findPackageRoot()
	const installedVersion: string = JSON.parse(
		readFileSync(join(root, 'package.json'), 'utf8'),
	).version
	const toVersion = process.argv[3] ?? installedVersion
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
	const wanted = sections.filter(
		section =>
			compareVersions(section.version, fromVersion) > 0 &&
			compareVersions(section.version, toVersion) <= 0,
	)
	if (wanted.length === 0) {
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
