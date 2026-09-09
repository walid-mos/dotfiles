import { readFile, readdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { digest, safeRelative } from './identity.ts'
import { DEVELOPMENT_IMAGE } from './model.ts'
import { configurationObject, readNativeConfig } from './native-config.ts'
import { quote } from './process.ts'
import { hasCode } from './store.ts'
import type { ProjectRecipe } from './model.ts'
import type { NativeConfig } from './native-config.ts'

const ASTRO_PORT = 4321
const DEFAULT_CPUS = 2
const DEFAULT_MEMORY = '3G'
const WRANGLER_CONFIG = 'wrangler.dev.jsonc'

async function packageDirectories(root: string, parent: string): Promise<string[]> {
  try {
    const entries = await readdir(join(root, parent), { withFileTypes: true })
    return entries.filter(entry => entry.isDirectory()).map(entry => `${parent}/${entry.name}`).sort()
  } catch (error) { if (hasCode(error, 'ENOENT')) return []; throw error }
}

async function workspaceDefinition(root: string): Promise<string> {
  try { return await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8') }
  catch (error) { if (hasCode(error, 'ENOENT')) return ''; throw error }
}

function hasAstroDevelopment(config: NativeConfig): boolean {
  const dependencies = configurationObject(config.settings.dependencies ?? {}, config.path)
  const devDependencies = configurationObject(config.settings.devDependencies ?? {}, config.path)
  const scripts = configurationObject(config.settings.scripts ?? {}, config.path)
  return typeof scripts.dev === 'string' && Boolean(dependencies.astro ?? devDependencies.astro)
}

function requireSupportedToolchain(manifest: NativeConfig): void {
  const manager = manifest.settings.packageManager
  if (typeof manager !== 'string' || !/^pnpm@11\./.test(manager)) throw new Error('The default environment requires pnpm 11 declared in package.json. Other toolchains need an explicit environment definition.')
  const engines = configurationObject(manifest.settings.engines ?? {}, manifest.path)
  if (typeof engines.node !== 'string' || !/^(>=|\^|~)?24(?:\.0(?:\.0)?)?$/.test(engines.node)) throw new Error('The default image supports Node 24; declare the supported engine in package.json or use an explicit environment definition.')
  const scripts = configurationObject(manifest.settings.scripts ?? {}, manifest.path)
  if (typeof scripts.dev !== 'string' || !scripts.dev.trim()) throw new Error('Declare the normal dev command in package.json before using wt.')
}

function localDatabases(config: NativeConfig): { commands: string[]; inputs: string[] } {
  const databases = config.settings.d1_databases ?? []
  if (!Array.isArray(databases)) throw new Error(`Invalid d1_databases in ${config.path}.`)
  const directory = dirname(config.path)
  const migrations = databases.map(value => {
    const database = configurationObject(value, config.path)
    if (typeof database.binding !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(database.binding)) throw new Error(`Invalid D1 binding in ${config.path}.`)
    const path = database.migrations_dir ?? 'migrations'
    if (typeof path !== 'string' || !path.trim()) throw new Error(`Invalid migrations_dir in ${config.path}.`)
    return {
      command: `pnpm --dir ${quote(directory)} exec wrangler d1 migrations apply ${quote(database.binding)} --local --config ${WRANGLER_CONFIG}`,
      input: join(directory, safeRelative(path)),
    }
  })
  return { commands: migrations.map(migration => migration.command), inputs: migrations.map(migration => migration.input) }
}

async function readConfigurations(root: string): Promise<{ manifests: NativeConfig[]; workers: NativeConfig[]; turbo?: NativeConfig }> {
  const directories = ['.', ...await packageDirectories(root, 'apps'), ...await packageDirectories(root, 'packages')]
  const manifests = await Promise.all(directories.map(directory => readNativeConfig(root, join(directory, 'package.json'))))
  const workers = await Promise.all(directories.map(directory => readNativeConfig(root, join(directory, WRANGLER_CONFIG))))
  return {
    manifests: manifests.filter(config => config !== undefined),
    workers: workers.filter(config => config !== undefined),
    turbo: await readNativeConfig(root, 'turbo.json'),
  }
}

export async function defaultRecipe(root: string): Promise<ProjectRecipe> {
  const { manifests, workers, turbo } = await readConfigurations(root)
  const manifest = manifests.find(config => config.path === 'package.json')
  if (!manifest) throw new Error('Expected package.json at the project root.')
  requireSupportedToolchain(manifest)
  if (manifests.filter(hasAstroDevelopment).length !== 1) throw new Error('The simple environment currently expects exactly one Astro frontend using its default port. Other layouts need an explicit environment definition.')
  await readFile(join(root, 'pnpm-lock.yaml'))
  const databases = workers.map(localDatabases)
  const definitions = [...manifests, ...workers, ...(turbo ? [turbo] : [])]
  return {
    version: 1, project: typeof manifest.settings.name === 'string' ? manifest.settings.name : basename(root),
    image: DEVELOPMENT_IMAGE, cpus: DEFAULT_CPUS, memory: DEFAULT_MEMORY, port: ASTRO_PORT,
    start: 'pnpm dev', prepare: ['pnpm install --frozen-lockfile', ...databases.flatMap(database => database.commands)],
    prepareInputs: ['pnpm-lock.yaml', 'pnpm-workspace.yaml', ...definitions.map(config => config.path), ...databases.flatMap(database => database.inputs)],
    persistPaths: workers.map(config => join(dirname(config.path), '.wrangler')),
    sourceRevision: digest(`${await workspaceDefinition(root)}\0${definitions.map(config => `${config.path}\0${config.source}`).join('\0')}`),
    env: { CI: '1', WRANGLER_SEND_METRICS: 'false', CHOKIDAR_USEPOLLING: 'true', CHOKIDAR_INTERVAL: '300' },
  }
}
