import { mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { checked, run } from './process.ts'
import { digest } from './identity.ts'
import { recipeRevision } from './recipe.ts'
import { workspaceData, workspaceFiles } from './store.ts'
import { APPLICATION_SOCKET, GUEST_APPLICATION_SOCKET, OWNER_LABEL, REVISION_LABEL } from './model.ts'
import type { RuntimeInspection, Workspace } from './model.ts'

const RUNTIME_SCHEMA_REVISION = 2

export async function inspectContainer(name: string): Promise<RuntimeInspection | undefined> {
  const inventory = JSON.parse(await checked('container', ['ls', '--all', '--format', 'json'])) as { id: string }[]
  if (!inventory.some(entry => entry.id === name)) return undefined
  return (JSON.parse(await checked('container', ['inspect', name])) as RuntimeInspection[])[0]
}

export function requireOwner(inspection: RuntimeInspection, workspace: Workspace): void {
  if (inspection.configuration.labels[OWNER_LABEL] !== workspace.id) throw new Error(`Refusing to operate on unowned container ${workspace.container}.`)
}

export async function runtimeRevision(workspace: Workspace): Promise<string> {
  const images = JSON.parse(await checked('container', ['image', 'inspect', workspace.recipe.image])) as { id: string }[]
  if (!images[0]?.id) throw new Error(`Image is not installed: ${workspace.recipe.image}. Build the development image first.`)
  return digest(`${RUNTIME_SCHEMA_REVISION}\0${recipeRevision(workspace.recipe)}\0${images[0].id}`)
}

export async function ensureRuntime(workspace: Workspace): Promise<Workspace> {
  const revision = await runtimeRevision(workspace)
  const current = await inspectContainer(workspace.container)
  if (current) return reconcileContainer(workspace, current, revision)
  await ensureNetwork(workspace)
  await createRuntime({ ...workspace, revision })
  return { ...workspace, revision, preparation: null }
}

async function reconcileContainer(workspace: Workspace, current: RuntimeInspection, revision: string): Promise<Workspace> {
  requireOwner(current, workspace)
  const isCompatible = current.configuration.labels[REVISION_LABEL] === revision
  if (!isCompatible && current.status.state === 'running') throw new Error('Development environment changed. Stop this workspace explicitly, then reopen to recreate compute while retaining data.')
  if (!isCompatible) {
    await checked('container', ['delete', workspace.container])
    return ensureRuntime({ ...workspace, preparation: null })
  }
  if (current.status.state !== 'running') {
    await unlink(join(workspaceFiles(workspace.id), 'application.pid')).catch(() => undefined)
    await checked('container', ['start', workspace.container])
  }
  return { ...workspace, revision }
}

async function ensureNetwork(workspace: Workspace): Promise<void> {
  const inventory = JSON.parse(await checked('container', ['network', 'ls', '--format', 'json'])) as { id: string }[]
  const name = workspace.container
  if (!inventory.some(entry => entry.id === name)) {
    await checked('container', ['network', 'create', '--label', `${OWNER_LABEL}=${workspace.id}`, name])
    return
  }
  const [network] = JSON.parse(await checked('container', ['network', 'inspect', name])) as { configuration: { labels: Record<string, string> } }[]
  if (network?.configuration.labels[OWNER_LABEL] !== workspace.id) throw new Error(`Refusing to reuse unowned network ${name}.`)
}

export function containerArguments(workspace: Workspace, identity: Record<string, string>): string[] {
  const files = workspaceFiles(workspace.id)
  const persistent = workspaceData(workspace.id)
  const mounts = [workspace.path, workspace.project.commonDir, files, persistent]
  const env = {
    ...workspace.recipe.env, ...identity,
    WT_WORKSPACE_ID: workspace.id, WT_WORKTREE: workspace.path, WT_DATA: persistent,
    WT_URL: `https://${workspace.hostname}`, TMPDIR: join(files, 'tmp'),
    WT_APPLICATION_SOCKET: GUEST_APPLICATION_SOCKET, WT_APPLICATION_PORT: String(workspace.recipe.port),
    __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: workspace.hostname,
    TURBO_CACHE_DIR: join(workspace.path, '.turbo/cache'),
  }
  return [
    'run', '--detach', '--name', workspace.container, '--network', workspace.container,
    '--cpus', String(workspace.recipe.cpus), '--memory', workspace.recipe.memory,
    '--label', `${OWNER_LABEL}=${workspace.id}`, '--label', `${REVISION_LABEL}=${workspace.revision}`,
    '--workdir', workspace.path,
    '--publish-socket', `${join(files, APPLICATION_SOCKET)}:${GUEST_APPLICATION_SOCKET}`,
    ...mounts.flatMap(path => ['--mount', `type=bind,source=${mountPath(path)},target=${mountPath(path)}`]),
    ...Object.entries(env).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
    workspace.recipe.image,
  ]
}

function mountPath(path: string): string {
  if (/[,:\n\r]/.test(path)) throw new Error(`Unsupported mount-path punctuation: ${path}`)
  return path
}

async function createRuntime(workspace: Workspace): Promise<void> {
  await mkdir(join(workspaceFiles(workspace.id), 'tmp'), { recursive: true, mode: 0o700 })
  const identity: Record<string, string> = {}
  for (const [key, config] of [['GIT_AUTHOR_NAME', 'user.name'], ['GIT_AUTHOR_EMAIL', 'user.email']] as const) {
    const result = await run('git', ['-C', workspace.project.root, 'config', '--get', config])
    if (result.code === 0) identity[key] = result.stdout.trim()
  }
  if (identity.GIT_AUTHOR_NAME) identity.GIT_COMMITTER_NAME = identity.GIT_AUTHOR_NAME
  if (identity.GIT_AUTHOR_EMAIL) identity.GIT_COMMITTER_EMAIL = identity.GIT_AUTHOR_EMAIL
  await checked('container', containerArguments(workspace, identity))
}

export async function stopRuntime(workspace: Workspace): Promise<void> {
  const current = await inspectContainer(workspace.container)
  if (!current) return
  requireOwner(current, workspace)
  if (current.status.state === 'running') await checked('container', ['stop', workspace.container])
}

export async function deleteRuntime(workspace: Workspace): Promise<void> {
  await stopRuntime(workspace)
  if (await inspectContainer(workspace.container)) await checked('container', ['delete', workspace.container])
  const networks = JSON.parse(await checked('container', ['network', 'ls', '--format', 'json'])) as { id: string }[]
  if (!networks.some(network => network.id === workspace.container)) return
  await ensureNetwork(workspace)
  await checked('container', ['network', 'delete', workspace.container])
}

