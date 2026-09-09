import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { checked } from './process.ts'
import { DNS_SUFFIX, ID_LENGTH, SLUG_LENGTH } from './model.ts'
import type { Project } from './model.ts'

export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, SLUG_LENGTH).replace(/-$/, '') || 'feature'
}

export function workspaceIdentity(projectId: string, branch: string): string {
  return digest(`${projectId}\0${branch}`).slice(0, ID_LENGTH)
}

export function featureHostname(project: string, branch: string, id: string): string {
  return `${slug(branch)}-${id.slice(0, 8)}.${slug(project)}.${DNS_SUFFIX}`
}

export async function resolveProject(cwd: string): Promise<Project> {
  const commonDir = await realpath(await checked('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir']))
  const listing = await checked('git', ['-C', cwd, 'worktree', 'list', '--porcelain'])
  const first = parseWorktrees(listing)[0]
  if (!first) throw new Error('A non-bare repository with a main checkout is required.')
  const root = await realpath(first.path)
  return { root, commonDir, id: digest(commonDir).slice(0, ID_LENGTH) }
}

export function parseWorktrees(listing: string): { path: string; branch?: string }[] {
  return listing.split('\n\n').filter(Boolean).map(block => {
    const lines = block.split('\n')
    const path = lines.find(line => line.startsWith('worktree '))?.slice('worktree '.length)
    if (!path || !isAbsolute(path) || path.startsWith('"')) throw new Error('Unsupported Git worktree path representation; use an ordinary absolute path without control characters.')
    const branch = lines.find(line => line.startsWith('branch refs/heads/'))?.slice('branch refs/heads/'.length)
    return { path, branch }
  })
}

export function safeRelative(path: string): string {
  if (isAbsolute(path) || path.split('/').includes('..') || path.startsWith('.git')) throw new Error(`Unsafe project-relative path: ${path}`)
  return path
}

export function containsPath(parent: string, candidate: string): boolean {
  const root = resolve(parent)
  const path = resolve(candidate)
  return path === root || path.startsWith(`${root}/`)
}

