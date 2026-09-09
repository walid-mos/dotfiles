import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'jsonc-parser'
import { hasCode } from './store.ts'
import type { ParseError } from 'jsonc-parser'

export interface NativeConfig {
  path: string
  source: string
  settings: Record<string, unknown>
}

export function configurationObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}: expected an object.`)
  return value as Record<string, unknown>
}

export async function readNativeConfig(root: string, path: string): Promise<NativeConfig | undefined> {
  let source: string
  try { source = await readFile(join(root, path), 'utf8') }
  catch (error) { if (hasCode(error, 'ENOENT')) return undefined; throw error }
  const errors: ParseError[] = []
  const settings: unknown = parse(source, errors, { allowTrailingComma: path.endsWith('.jsonc'), disallowComments: !path.endsWith('.jsonc') })
  if (errors.length) throw new Error(`Invalid ${path}: fix the native configuration before opening a workspace.`)
  return { path, source, settings: configurationObject(settings, path) }
}
