import { mkdir, readFile, readdir } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { digest } from './identity.ts'
import { CONFIG_FILE } from './model.ts'
import { atomicJson, hasCode, stateRoot } from './store.ts'
import type { Project, ProjectRecipe } from './model.ts'

const DEFAULT_CPUS = 2
const DEFAULT_MEMORY = '2G'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object in .workspace.json.')
  return value as Record<string, unknown>
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new Error(`Expected a nonempty ${label}.`)
  return value
}

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`Expected an array: ${label}.`)
  return value.map(entry => text(entry, label))
}

export function safeRelative(path: string): string {
  if (isAbsolute(path) || path.split('/').includes('..') || path.startsWith('.git')) throw new Error(`Unsafe project-relative path: ${path}`)
  return path
}

export function parseRecipe(source: string): ProjectRecipe {
  const recipe = object(JSON.parse(source))
  const allowed = ['version', 'project', 'image', 'cpus', 'memory', 'prepare', 'prepareInputs', 'persistPaths', 'start', 'port', 'env']
  const unknown = Object.keys(recipe).filter(key => !allowed.includes(key))
  if (unknown.length) throw new Error(`Unsupported recipe keys: ${unknown.join(', ')}`)
  if (recipe.version !== 1) throw new Error('Expected recipe version 1.')
  const port = Number(recipe.port)
  const cpus = Number(recipe.cpus ?? DEFAULT_CPUS)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Expected an application port between 1 and 65535.')
  if (!Number.isInteger(cpus) || cpus < 1 || cpus > 32) throw new Error('Expected 1–32 CPUs.')
  const memory = text(recipe.memory ?? DEFAULT_MEMORY, 'memory limit')
  if (!/^[1-9][0-9]*[MG]$/.test(memory)) throw new Error('Expected memory such as 512M or 2G.')
  const env = Object.fromEntries(Object.entries(object(recipe.env ?? {})).map(([key, value]) => {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key) || key.startsWith('WT_')) throw new Error(`Invalid/reserved environment key: ${key}`)
    return [key, text(value, `environment value ${key}`)]
  }))
  return {
    version: 1, project: text(recipe.project, 'project name'), image: text(recipe.image, 'image'),
    cpus, memory, port, env, start: text(recipe.start, 'start command'),
    prepare: strings(recipe.prepare ?? [], 'prepare'),
    prepareInputs: strings(recipe.prepareInputs ?? ['pnpm-lock.yaml'], 'prepareInputs').map(safeRelative),
    persistPaths: strings(recipe.persistPaths ?? [], 'persistPaths').map(safeRelative),
  }
}

export async function loadRecipe(project: Project, worktree?: string): Promise<ProjectRecipe> {
  const primary = join(worktree ?? project.root, CONFIG_FILE)
  try { return parseRecipe(await readFile(primary, 'utf8')) }
  catch (error) {
    if (!worktree || !hasCode(error, 'ENOENT')) throw error
    return parseRecipe(await readFile(join(project.root, CONFIG_FILE), 'utf8'))
  }
}

export function recipeRevision(recipe: ProjectRecipe): string { return digest(JSON.stringify(recipe)) }

export async function approveRecipe(project: Project, recipe: ProjectRecipe): Promise<void> {
  const directory = join(stateRoot(), 'trusted', project.id)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await atomicJson(join(directory, `${recipeRevision(recipe)}.json`), { project: project.root, recipe })
}

export async function requireTrustedRecipe(project: Project, recipe: ProjectRecipe): Promise<void> {
  const approved = join(stateRoot(), 'trusted', project.id, `${recipeRevision(recipe)}.json`)
  try { await readFile(approved) }
  catch (error) {
    if (!hasCode(error, 'ENOENT')) throw error
    throw new Error('Project environment is not trusted, or its recipe changed. Review .workspace.json, then run wt trust from that checkout. No project commands were executed.')
  }
}

export async function preparationDigest(path: string, recipe: ProjectRecipe): Promise<string> {
  const parts = [recipeRevision(recipe)]
  for (const input of recipe.prepareInputs) parts.push(await hashInput(join(path, input), path))
  return digest(parts.join('\0'))
}

async function hashInput(path: string, root: string): Promise<string> {
  try { return `${relative(root, path)}:${digest(await readFile(path, 'utf8'))}` }
  catch (error) {
    if (hasCode(error, 'ENOENT')) return `${relative(root, path)}:absent`
    if (!hasCode(error, 'EISDIR')) throw error
    const entries = (await readdir(path)).sort()
    return (await Promise.all(entries.map(entry => hashInput(join(path, entry), root)))).join('\0')
  }
}
