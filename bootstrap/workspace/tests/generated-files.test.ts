import assert from 'node:assert/strict'
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { resolveProject } from '../src/identity.ts'
import { checked } from '../src/process.ts'
import { parseRecipe } from '../src/recipe.ts'
import { obtainWorktree, prepareStorage } from '../src/worktrees.ts'

test('generated caches and persistence links stay untracked without hiding user files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wt-excludes-'))
  const root = join(directory, 'repo')
  const previousState = process.env.WT_STATE_HOME
  const previousBase = process.env.WORKTREES_BASE
  process.env.WT_STATE_HOME = join(directory, 'state')
  process.env.WORKTREES_BASE = join(directory, 'worktrees')
  try {
    await mkdir(root)
    await checked('git', ['init', '-q', root])
    await checked('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture'])
    const project = await resolveProject(root)
    const exclude = join(project.commonDir, 'info/exclude')
    await appendFile(exclude, '\n/keep-private\n')
    const recipe = parseRecipe(JSON.stringify({ version: 1, project: 'fixture', image: 'node:24', start: 'true', port: 3000, persistPaths: ['apps/api/.wrangler', 'apps/[api]/.wrangler'] }))
    const workspace = await obtainWorktree(project, 'feature', recipe)
    await prepareStorage(workspace)
    await mkdir(join(workspace.path, '.pnpm-store'), { recursive: true })
    await writeFile(join(workspace.path, '.pnpm-store/package'), 'generated cache')
    await mkdir(join(workspace.path, 'apps/a'), { recursive: true })
    await writeFile(join(workspace.path, 'apps/a/.wrangler'), 'unmanaged user file')
    await writeFile(join(workspace.path, 'notes.txt'), 'valuable work')
    assert.equal(await checked('git', ['-C', workspace.path, 'status', '--porcelain', '--untracked-files=all']), '?? apps/a/.wrangler\n?? notes.txt')
    const first = await readFile(exclude, 'utf8')
    assert.match(first, /\/keep-private/)
    await prepareStorage(workspace)
    assert.equal(await readFile(exclude, 'utf8'), first)
  } finally {
    if (previousState === undefined) delete process.env.WT_STATE_HOME
    else process.env.WT_STATE_HOME = previousState
    if (previousBase === undefined) delete process.env.WORKTREES_BASE
    else process.env.WORKTREES_BASE = previousBase
    await rm(directory, { recursive: true, force: true })
  }
})
