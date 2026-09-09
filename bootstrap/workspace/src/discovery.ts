import { existsSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { CONFIG_FILE } from './model.ts'
import { configurationObject, readNativeConfig } from './native-config.ts'
import { workspaceAt } from './store.ts'
import type { Workspace } from './model.ts'

async function isDevelopmentProject(directory: string): Promise<boolean> {
  if (existsSync(join(directory, CONFIG_FILE))) return true
  if (!existsSync(join(directory, 'pnpm-lock.yaml'))) return false
  const manifest = await readNativeConfig(directory, 'package.json')
  if (!manifest) throw new Error('A pnpm project is missing package.json; native execution is blocked.')
  const scripts = configurationObject(manifest.settings.scripts ?? {}, manifest.path)
  return typeof scripts.dev === 'string'
}

export async function locateExecutionWorkspace(cwd: string): Promise<Workspace | null> {
  const path = await realpath(cwd)
  const workspace = await workspaceAt(path)
  if (workspace) return workspace
  let directory = path
  while (true) {
    if (await isDevelopmentProject(directory)) throw new Error('This project requires a managed environment. Open a feature with wt open; native execution is blocked.')
    const parent = dirname(directory)
    if (parent === directory || existsSync(join(directory, '.git'))) return null
    directory = parent
  }
}
