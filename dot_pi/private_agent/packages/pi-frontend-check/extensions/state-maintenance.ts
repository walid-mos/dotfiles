import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { specimensDir } from './capture-specimen.ts'
import { captureDir } from './pixel-capture-store.ts'
import { maintainProfileDir, profilesRoot } from './profile-store.ts'

const MS_PER_DAY = 86_400_000
const RETENTION_DAYS = 14
const STATE_RETENTION_MS = RETENTION_DAYS * MS_PER_DAY

type EntryMaintainer = (path: string, cutoffMs: number) => void
type MaintainedDir = readonly [root: () => string, maintain: EntryMaintainer]

function removeExpiredFile(path: string, cutoffMs: number): void {
	const stats = statSync(path)
	if (stats.isFile() && stats.mtimeMs < cutoffMs)
		rmSync(path, { force: true })
}

const MAINTAINED_DIRS: readonly MaintainedDir[] = [
	[profilesRoot, maintainProfileDir],
	[captureDir, removeExpiredFile],
	[specimensDir, removeExpiredFile],
]

function maintainEntries(
	root: string,
	maintain: EntryMaintainer,
	cutoffMs: number,
): void {
	if (!existsSync(root)) return
	for (const name of readdirSync(root)) {
		try {
			maintain(join(root, name), cutoffMs)
		} catch {
			// An entry removed or rewritten mid-sweep is not load-fatal.
		}
	}
}

export function maintainState(): void {
	const cutoffMs = Date.now() - STATE_RETENTION_MS
	for (const [root, maintain] of MAINTAINED_DIRS) {
		try {
			maintainEntries(root(), maintain, cutoffMs)
		} catch {
			// An unreadable directory must neither skip the others nor block the extension load.
		}
	}
}
