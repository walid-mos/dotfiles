import { mkdir, open, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { hasCode, stateRoot } from './store.ts'
import { POLL_INTERVAL_MS } from './model.ts'

const LOCK_TIMEOUT_MS = 900_000

export async function withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  if (!/^[a-z0-9-]+$/.test(key)) throw new Error('Invalid lifecycle lock key.')
  const directory = join(stateRoot(), 'locks')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, `${key}.lock`)
  const handle = await acquire(path)
  try { return await operation() }
  finally { await handle.close(); await unlink(path) }
}

async function acquire(path: string) {
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  while (Date.now() < deadline) {
    const handle = await tryAcquire(path)
    if (handle) return handle
    await delay(POLL_INTERVAL_MS)
  }
  throw new Error(`Lifecycle lock timed out: ${path}. Inspect its owner before removing a stale lock.`)
}

async function tryAcquire(path: string) {
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.writeFile(JSON.stringify({ pid: process.pid, created: new Date().toISOString() }))
    return handle
  } catch (error) {
    if (!hasCode(error, 'EEXIST')) throw error
    const owner = await readFile(path, 'utf8').catch(() => '')
    if (owner) assertLiveOwner(path, owner)
    return undefined
  }
}

function assertLiveOwner(path: string, source: string): void {
  const owner = JSON.parse(source) as { pid: number }
  try { process.kill(owner.pid, 0) }
  catch (error) {
    if (hasCode(error, 'ESRCH')) throw new Error(`Interrupted operation left ${path}. No owner process remains. Inspect workspace state, then remove this exact lock and retry.`)
    throw error
  }
}
