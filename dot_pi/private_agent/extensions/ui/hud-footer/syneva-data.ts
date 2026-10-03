// The footer reads only the live Syneva desk attached to this Pi session.
// The reviewed repo may be a temporary mirror unrelated to the Pi cwd.
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import { isRecord } from './json.ts'

import type { ExtensionContext } from '@earendil-works/pi-coding-agent'

const ATTACHMENT_ENTRY = 'syneva-attachment'
const SYNEVA_DIR = '.syneva'
const DESK_LOCK = 'desk.lock'
const HASH_SPAN = 16
const SAFE_SESSION = /^[a-zA-Z0-9._-]+$/

type SessionManager = Pick<
	ExtensionContext['sessionManager'],
	'getEntries' | 'getSessionId'
>

export type SynevaDesk = { session: string; url: string }

function attachedTarget(
	manager: SessionManager,
): { repo: string; session: string } | null {
	const entry = manager
		.getEntries()
		.findLast(
			candidateEntry =>
				candidateEntry.type === 'custom' &&
				candidateEntry.customType === ATTACHMENT_ENTRY,
		)
	if (
		!entry ||
		entry.type !== 'custom' ||
		!isRecord(entry.data) ||
		entry.data.owner !== manager.getSessionId()
	)
		return null
	const { target } = entry.data
	if (
		!isRecord(target) ||
		typeof target.repo !== 'string' ||
		typeof target.session !== 'string'
	)
		return null
	if (!target.repo || !SAFE_SESSION.test(target.session)) return null
	return { repo: target.repo, session: target.session }
}

function liveDesk(raw: string, session: string): SynevaDesk | null {
	let lock: unknown
	try {
		lock = JSON.parse(raw)
	} catch {
		return null
	}
	if (
		!isRecord(lock) ||
		lock.session !== session ||
		typeof lock.url !== 'string' ||
		!/^https?:\/\//.test(lock.url) ||
		typeof lock.pid !== 'number' ||
		!Number.isInteger(lock.pid) ||
		lock.pid <= 0
	)
		return null
	try {
		process.kill(lock.pid, 0)
		return { session, url: lock.url }
	} catch {
		return null
	}
}

export async function fetchAttachedSynevaDesk(
	manager: SessionManager,
	baseDir: string = homedir(),
): Promise<SynevaDesk | null> {
	const target = attachedTarget(manager)
	if (!target) return null
	const repoHash = createHash('sha256')
		.update(target.repo)
		.digest('hex')
		.slice(0, HASH_SPAN)
	const lockPath = path.join(
		baseDir,
		SYNEVA_DIR,
		repoHash,
		target.session,
		DESK_LOCK,
	)
	const raw = await fs.readFile(lockPath, 'utf8').catch(() => null)
	if (!raw) return null
	return liveDesk(raw, target.session)
}
