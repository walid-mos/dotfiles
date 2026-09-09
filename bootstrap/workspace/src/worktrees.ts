import { lstat, mkdir, realpath, symlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { checked, run } from './process.ts'
import { featureHostname, parseWorktrees, slug, workspaceIdentity } from './identity.ts'
import { loadWorkspace, saveWorkspace, workspaceData, workspaceFiles, hasCode } from './store.ts'
import { recipeRevision } from './recipe.ts'
import type { Project, ProjectRecipe, Workspace } from './model.ts'

export async function obtainWorktree(project: Project, branch: string, recipe: ProjectRecipe): Promise<Workspace> {
  await checked('git', ['check-ref-format', '--branch', branch])
  const id = workspaceIdentity(project.id, branch)
  const existing = await loadWorkspace(id)
  if (existing && existing.phase !== 'removed') { await verifyCheckout(existing); return { ...existing, recipe } }
  const path = join(process.env.WORKTREES_BASE ?? join(homedir(), 'Development/worktrees'), `${slug(recipe.project)}-${slug(branch)}-${id}`)
  const listing = parseWorktrees(await checked('git', ['-C', project.root, 'worktree', 'list', '--porcelain']))
  if (listing.some(entry => entry.branch === branch)) throw new Error(`Branch ${branch} already has an unmanaged checkout. Refusing to adopt or duplicate it implicitly.`)
  const hasBranch = (await run('git', ['-C', project.root, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`])).code === 0
  await mkdir(dirname(path), { recursive: true })
  await checked('git', ['-C', project.root, 'worktree', 'add', ...(hasBranch ? [] : ['-b', branch]), path, ...(hasBranch ? [branch] : ['HEAD'])])
  const workspace: Workspace = {
    version: 1, id, project, branch, path: await realpath(path), container: `wt-${id}`,
    recipe, revision: recipeRevision(recipe), preparation: null, phase: 'preparing',
    hostname: featureHostname(recipe.project, branch, id),
  }
  await saveWorkspace(workspace)
  return workspace
}

export async function verifyCheckout(workspace: Workspace): Promise<void> {
  const actual = await realpath(workspace.path)
  if (actual !== workspace.path) throw new Error('Workspace path changed. Explicit repair is required.')
  const branch = await checked('git', ['-C', actual, 'branch', '--show-current'])
  const commonDir = await realpath(await checked('git', ['-C', actual, 'rev-parse', '--path-format=absolute', '--git-common-dir']))
  if (branch !== workspace.branch || commonDir !== workspace.project.commonDir) throw new Error('Workspace Git identity changed. Refusing to operate on a different checkout.')
}

export async function prepareStorage(workspace: Workspace): Promise<void> {
  await mkdir(workspaceData(workspace.id), { recursive: true, mode: 0o700 })
  await mkdir(workspaceFiles(workspace.id), { recursive: true, mode: 0o700 })
  for (const path of workspace.recipe.persistPaths) await linkPersistentPath(workspace, path)
}

async function linkPersistentPath(workspace: Workspace, relativePath: string): Promise<void> {
  const target = join(workspaceData(workspace.id), relativePath)
  const link = join(workspace.path, relativePath)
  await mkdir(target, { recursive: true, mode: 0o700 })
  await mkdir(dirname(link), { recursive: true })
  const existing = await lstat(link).catch(error => { if (hasCode(error, 'ENOENT')) return undefined; throw error })
  if (existing) {
    if (existing.isSymbolicLink() && await realpath(link) === await realpath(target)) return
    throw new Error(`Persistent path already contains unmanaged state: ${link}. Preserve and migrate it explicitly.`)
  }
  await symlink(target, link)
}

export async function assertCleanForRemoval(workspace: Workspace): Promise<void> {
  await verifyCheckout(workspace)
  const status = await checked('git', ['-C', workspace.path, 'status', '--porcelain', '--untracked-files=all'])
  if (status) throw new Error(`Workspace contains changes; removal refused:\n${status}`)
}

export async function removeCheckout(workspace: Workspace): Promise<void> {
  await checked('git', ['-C', workspace.project.root, 'worktree', 'remove', workspace.path])
  // The branch and service data are retained deliberately, including unpushed commits.
}
