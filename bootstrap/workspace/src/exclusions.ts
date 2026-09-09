import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hasCode } from './store.ts'
import type { Workspace } from './model.ts'

const GENERATED_CACHE_PATHS = ['.pnpm-store/']

function anchoredPattern(path: string): string {
  if (/[\r\n]/.test(path)) throw new Error('Generated paths must not contain line breaks.')
  return `/${path.replace(/[\\*?[\]]/g, '\\$&')}`
}

export async function excludeGeneratedPaths(workspace: Workspace): Promise<void> {
  const directory = join(workspace.project.commonDir, 'info')
  await mkdir(directory, { recursive: true })
  const path = join(directory, 'exclude')
  const existing = await readFile(path, 'utf8').catch(error => {
    if (hasCode(error, 'ENOENT')) return ''
    throw error
  })
  const patterns = [...GENERATED_CACHE_PATHS, ...workspace.recipe.persistPaths].map(anchoredPattern)
  const missing = [...new Set(patterns)].filter(pattern => !existing.split('\n').includes(pattern))
  if (!missing.length) return
  const separator = existing.endsWith('\n') ? '' : '\n'
  await appendFile(path, `${separator}${missing.join('\n')}\n`)
}
