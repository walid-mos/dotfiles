import { createHash, randomUUID } from 'node:crypto'
/** Only the elected Pi session writes naming state; commands write reset requests. */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { Value } from 'typebox/value'

import { SavedState } from './contracts.ts'

const socket =
	process.env.HERDR_SOCKET_PATH ??
	path.join(os.homedir(), '.config', 'herdr', 'herdr.sock')
const SERVER_KEY_LENGTH = 16
export const serverKey = createHash('sha256')
	.update(socket)
	.digest('hex')
	.slice(0, SERVER_KEY_LENGTH)
export const STATE_DIR = path.join(
	os.homedir(),
	'.config',
	'herdr',
	'task-names',
	serverKey,
)
const STATE_PATH = path.join(STATE_DIR, 'state.json')
export const selectionPath = (paneId: string): string =>
	path.join(STATE_DIR, `branch-${encodeURIComponent(paneId)}.json`)
const resetPath = (tabId: string): string =>
	path.join(STATE_DIR, `auto-${encodeURIComponent(tabId)}.json`)

export async function optionalJson(file: string): Promise<unknown> {
	try {
		return JSON.parse(await readFile(file, 'utf8'))
	} catch (cause) {
		if (
			cause &&
			typeof cause === 'object' &&
			Reflect.get(cause, 'code') === 'ENOENT'
		)
			return undefined
		throw new Error(`Cannot read naming state ${file}`, { cause })
	}
}

export async function saveJson(file: string, content: unknown): Promise<void> {
	await mkdir(STATE_DIR, { recursive: true, mode: 0o700 })
	const staging = `${file}.${randomUUID()}.tmp`
	await writeFile(staging, JSON.stringify(content), { mode: 0o600 })
	await rename(staging, file)
}

export async function loadState(): Promise<SavedState> {
	const saved = await optionalJson(STATE_PATH)
	if (typeof saved === 'undefined')
		return {
			tabs: {},
			fingerprint: '',
			keys: {},
			titles: { panes: [], tabs: [] },
		}
	if (!Value.Check(SavedState, saved))
		throw new Error(`Invalid naming state: ${STATE_PATH}`)
	return saved
}

export const saveState = (state: SavedState): Promise<void> =>
	saveJson(STATE_PATH, state)
export const requestAutomatic = (tabId: string): Promise<void> =>
	saveJson(resetPath(tabId), { tabId })
export async function consumeAutomatic(tabId: string): Promise<boolean> {
	try {
		await unlink(resetPath(tabId))
		return true
	} catch (cause) {
		if (
			cause &&
			typeof cause === 'object' &&
			Reflect.get(cause, 'code') === 'ENOENT'
		)
			return false
		throw cause
	}
}
