import { realpath, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveProject, workspaceIdentity } from './identity.ts'
import { loadRecipe, preparationDigest, requireTrustedRecipe } from './recipe.ts'
import { loadWorkspace, saveWorkspace, workspaceAt, workspaceFiles } from './store.ts'
import { obtainWorktree, prepareStorage, verifyCheckout, assertCleanForRemoval, removeCheckout } from './worktrees.ts'
import { deleteRuntime, ensureRuntime, stopRuntime } from './runtime.ts'
import { ensureApplication, prepareProject } from './application.ts'
import { withLock } from './lock.ts'
import { attachHerdr, closeHerdr, requireIdleAgents } from './herdr.ts'
import { updateGateway } from './gateway.ts'
import type { Workspace } from './model.ts'

export async function openWorkspace(cwd: string, branch: string, mode: 'headless' | 'herdr', focus: 'preserve' | 'workspace' = 'workspace'): Promise<Workspace> {
  const project = await resolveProject(cwd)
  return withLock(`repo-${project.id}`, async () => {
    const previous = await loadWorkspace(workspaceIdentity(project.id, branch))
    const recipe = await loadRecipe(project, previous?.phase !== 'removed' ? previous?.path : undefined)
    await requireTrustedRecipe(project, recipe)
    const workspace = await obtainWorktree(project, branch, recipe)
    const checkoutRecipe = await loadRecipe(project, workspace.path)
    const ready = await makeReady({ ...workspace, recipe: checkoutRecipe })
    if (mode === 'headless') return ready
    return attachHerdr(ready, focus)
  })
}

export async function ensureWorkspace(cwd: string): Promise<Workspace> {
  const workspace = await workspaceAt(await realpath(cwd))
  if (!workspace) throw new Error('This directory is not a managed workspace. Use wt open <feature> from its project.')
  return withLock(`repo-${workspace.project.id}`, async () => {
    const current = await loadWorkspace(workspace.id)
    if (!current || current.phase === 'removed') throw new Error('Workspace was removed.')
    const recipe = await loadRecipe(current.project, current.path)
    return makeReady({ ...current, recipe })
  })
}

async function makeReady(workspace: Workspace): Promise<Workspace> {
  await requireTrustedRecipe(workspace.project, workspace.recipe)
  await verifyCheckout(workspace)
  let preparing: Workspace = { ...workspace, phase: 'preparing', error: undefined }
  await saveWorkspace(preparing)
  try {
    await prepareStorage(preparing)
    preparing = await ensureRuntime(preparing)
    await saveWorkspace(preparing)
    const fingerprint = `${preparing.revision}:${await preparationDigest(preparing.path, preparing.recipe)}`
    if (preparing.preparation !== fingerprint) await prepareProject(preparing)
    await ensureApplication(preparing)
    const ready: Workspace = { ...preparing, phase: 'ready', preparation: fingerprint }
    await saveWorkspace(ready)
    await updateGateway()
    return ready
  } catch (error) {
    await saveWorkspace({ ...preparing, phase: 'failed', error: error instanceof Error ? error.message : String(error) })
    throw error
  }
}

export async function findWorkspace(cwd: string, target?: string): Promise<Workspace> {
  if (target && /^[a-f0-9]{16}$/.test(target)) {
    const workspace = await loadWorkspace(target)
    if (!workspace) throw new Error(`Unknown workspace: ${target}`)
    return workspace
  }
  if (!target) {
    const workspace = await workspaceAt(await realpath(cwd))
    if (workspace) return workspace
  }
  const project = await resolveProject(cwd)
  const workspace = target ? await loadWorkspace(workspaceIdentity(project.id, target)) : undefined
  if (!workspace) throw new Error('Specify an existing feature branch or workspace ID.')
  return workspace
}

export async function stopWorkspace(workspace: Workspace): Promise<void> {
  await withLock(`repo-${workspace.project.id}`, async () => {
    await requireIdleAgents(workspace)
    await stopRuntime(workspace)
    await unlink(join(workspaceFiles(workspace.id), 'application.pid')).catch(() => undefined)
    await saveWorkspace({ ...workspace, phase: 'stopped', error: undefined })
    await updateGateway()
  })
}

export async function removeWorkspace(workspace: Workspace, confirmation: string): Promise<void> {
  if (confirmation !== workspace.id) throw new Error(`Removal requires --confirm ${workspace.id}. Branch and persistent data will be retained.`)
  await withLock(`repo-${workspace.project.id}`, async () => {
    await assertCleanForRemoval(workspace)
    await requireIdleAgents(workspace)
    await closeHerdr(workspace)
    await deleteRuntime(workspace)
    await removeCheckout(workspace)
    await saveWorkspace({ ...workspace, phase: 'removed' })
    await updateGateway()
  })
}
