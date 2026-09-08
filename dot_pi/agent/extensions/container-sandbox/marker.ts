// Worktree marker bookkeeping: flagging a project directory as
// "containerize this worktree". The marker interacts with git excludes.
import {
	existsSync,
	unlinkSync,
	writeFileSync,
	appendFileSync,
	readFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { loadConfig } from './config'

export function markWorktree(cwd: string, isMarked: boolean): void {
	const config = loadConfig(cwd)
	const markerPath = join(cwd, config.markerFile)
	if (isMarked) {
		writeFileSync(markerPath, '')
		keepMarkerUntracked(cwd, config.markerFile)
		return
	}
	if (existsSync(markerPath)) unlinkSync(markerPath)
}

function resolveGitCommonDir(cwd: string): string | null {
	try {
		const dotGit = readFileSync(join(cwd, '.git'), 'utf-8').trim()
		const match = dotGit.match(/^gitdir:\s*(.+)$/m)
		const [, gitdir] = match ?? []
		if (!gitdir) {
			return null
		}
		// A worktree's .git file points at <common>/worktrees/<name>; the
		// common dir is two levels up.
		const wtDir = gitdir.startsWith('/') ? gitdir : join(cwd, gitdir)
		return join(wtDir, '..', '..')
	} catch {
		return null
	}
}

function keepMarkerUntracked(cwd: string, markerFile: string): void {
	// The marker is a per-worktree, per-machine decision - it must never be
	// committed, so it goes into the git common dir excludes.
	const gitDirPath = resolveGitCommonDir(cwd) ?? join(cwd, '.git')
	const excludePath = join(gitDirPath, 'info', 'exclude')
	try {
		const existing = readFileSync(excludePath, 'utf-8')
		if (existing.split('\n').includes(markerFile)) return
		appendFileSync(excludePath, `\n${markerFile}\n`)
	} catch {
		appendFileSync(excludePath, `${markerFile}\n`)
	}
}
