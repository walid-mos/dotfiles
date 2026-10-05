/** Flag running pi sessions whose process predates the installed release.
 * Run from ~/.pi/agent:
 *   node skills/pi-updated/scripts/stale-session-check.ts
 * A session started before the install keeps its pre-update modules in memory
 * (jiti loader, docs paths, display adapters). When an update replaces the
 * pnpm store, those in-memory paths dangle and extensions fail with
 * "Cannot find module" on the next uncached load; /reload cannot swap
 * already-loaded modules - only a full restart of the session does. Exit 1
 * when at least one stale session is found. The other pi-updated scripts
 * audit the disk and cannot see this; pi hides its argv behind
 * process.title, so detection compares each running session's ps lstart
 * against the installed package directory's mtime. */
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { findPackage } from './lib-pi-package.ts'

const MONTH_INDEX: Record<string, number> = {
	Jan: 1,
	Feb: 2,
	Mar: 3,
	Apr: 4,
	May: 5,
	Jun: 6,
	Jul: 7,
	Aug: 8,
	Sep: 9,
	Oct: 10,
	Nov: 11,
	Dec: 12,
}

interface PiProcess {
	pid: string
	started: Date
}

/** `Sun Oct  4 02:17:47 2026` (ps lstart, host local time) → local Date. */
function parseLstart(lstart: string): Date | undefined {
	const normalized = lstart.replaceAll('  ', ' ')
	const match =
		/^([A-Za-z]{3}) ([A-Za-z]{3}) (\d+) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(
			normalized,
		)
	if (!match) return undefined
	const [, , month, day, hour, minute, second, year] = match
	if (!month || !day || !hour || !minute || !second || !year) return undefined
	const monthIndex = MONTH_INDEX[month]
	if (!monthIndex) return undefined
	return new Date(
		Number(year),
		monthIndex - 1,
		Number(day),
		Number(hour),
		Number(minute),
		Number(second),
	)
}

/** Running processes that look like pi sessions. pi sets process.title to
 * `pi`, hiding its argv, so the command is bare `pi` (or a full path ending
 * in /pi for launchers that skip the title, or the bundle path itself). */
function findPiProcesses(): PiProcess[] {
	const listing = execFileSync(
		'ps',
		['-axww', '-o', 'pid=,lstart=,command='],
		{
			encoding: 'utf8',
		},
	)
	const processes: PiProcess[] = []
	for (const line of listing.split('\n')) {
		const match = /^\s*(\d+)\s+(\S.+\S)\s{2,}(.+)$/.exec(line)
		if (!match) continue
		const [, pid, lstart, rawCommand] = match
		if (!pid || !lstart) continue
		const command = (rawCommand ?? '').trim()
		const isPiSession =
			/(^|\/)pi( |$)/.test(command) || command.includes('pi-coding-agent')
		if (!isPiSession) continue
		const started = parseLstart(lstart)
		if (!started) continue
		processes.push({ pid, started })
	}
	return processes
}

function installedVersion(root: string): string {
	const manifest: unknown = JSON.parse(
		readFileSync(join(root, 'package.json'), 'utf8'),
	)
	if (
		typeof manifest === 'object' &&
		manifest !== null &&
		'version' in manifest &&
		typeof manifest.version === 'string'
	)
		return manifest.version
	return 'unknown'
}

async function main(): Promise<number> {
	const root = findPackage()
	const installedMs = statSync(root).mtimeMs
	process.stdout.write(
		`installed pi: ${installedVersion(root)} (${root})\ninstalled at: ${new Date(installedMs).toLocaleString()} (package dir mtime)\n\n`,
	)

	const processes = findPiProcesses()
	if (!processes.length) {
		process.stdout.write('✓ no running pi sessions found.\n')
		return 0
	}
	const stale = processes.filter(
		piProcess => piProcess.started.getTime() < installedMs,
	)
	for (const piProcess of processes) {
		if (!stale.includes(piProcess)) continue
		process.stdout.write(
			`✗ stale pi session: pid ${piProcess.pid}, started ${piProcess.started.toLocaleString()} - predates the installed release. Restart it (exit and relaunch); /reload is not enough: its in-memory jiti loader and modules still resolve into the replaced pnpm store, so extensions fail with "Cannot find module" once the old store is removed.\n`,
		)
	}
	process.stdout.write(
		`\n${stale.length ? '✗' : '✓'} ${stale.length} of ${processes.length} running pi sessions predate the installed release.\n`,
	)
	return stale.length ? 1 : 0
}

process.exitCode = await main()
