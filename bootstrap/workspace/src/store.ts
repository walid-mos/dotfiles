import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { containsPath } from './identity.ts'
import type { Workspace } from './model.ts'

export function stateRoot(): string {
  return process.env.WT_STATE_HOME ?? join(homedir(), '.local/share/studio-workspace')
}

export function recordsRoot(): string { return join(stateRoot(), 'workspaces') }
export function workspaceFiles(id: string): string { validateId(id); return join(stateRoot(), 'files', id) }
export function workspaceData(id: string): string { validateId(id); return join(stateRoot(), 'persistent', id) }

export async function atomicJson(path: string, value: unknown): Promise<void> {
  const staging = `${path}.${randomUUID()}.new`
  await writeFile(staging, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(staging, path)
}

export function validateId(id: string): void {
  if (!/^[a-f0-9]{16}$/.test(id)) throw new Error(`Invalid workspace identity: ${id}`)
}

export async function saveWorkspace(workspace: Workspace): Promise<void> {
  validateId(workspace.id)
  await mkdir(recordsRoot(), { recursive: true, mode: 0o700 })
  await atomicJson(join(recordsRoot(), `${workspace.id}.json`), workspace)
}

export async function loadWorkspace(id: string): Promise<Workspace | undefined> {
  validateId(id)
  try {
    const record = JSON.parse(await readFile(join(recordsRoot(), `${id}.json`), 'utf8')) as Workspace
    if (record.version !== 1 || record.id !== id) throw new Error(`Unsupported workspace record: ${id}`)
    return record
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return undefined
    throw error
  }
}

export async function listWorkspaces(): Promise<Workspace[]> {
  await mkdir(recordsRoot(), { recursive: true, mode: 0o700 })
  const filenames = (await readdir(recordsRoot())).filter(name => /^[a-f0-9]{16}\.json$/.test(name))
  const records = await Promise.all(filenames.map(name => loadWorkspace(name.slice(0, -5))))
  return records.filter((record): record is Workspace => record !== undefined)
}

export async function workspaceAt(cwd: string): Promise<Workspace | undefined> {
  const records = await listWorkspaces()
  return records.find(record => record.phase !== 'removed' && containsPath(record.path, cwd))
}

export function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
