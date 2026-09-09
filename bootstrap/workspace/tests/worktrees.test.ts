import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { checked } from '../src/process.ts'
import { resolveProject } from '../src/identity.ts'
import { parseRecipe } from '../src/recipe.ts'
import { assertCleanForRemoval, obtainWorktree, removeCheckout } from '../src/worktrees.ts'

const recipe = parseRecipe(JSON.stringify({ version: 1, project: 'fixture', image: 'node:24', start: 'true', port: 3000 }))

test('real Git worktrees are collision-safe, refuse dirty removal and retain branches', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wt-git-'))
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
    const first = await obtainWorktree(project, 'feature/a', recipe)
    const second = await obtainWorktree(project, 'feature-a', recipe)
    assert.notEqual(first.path, second.path)
    assert.equal((await obtainWorktree(project, 'feature/a', recipe)).id, first.id)
    await writeFile(join(first.path, 'valuable.txt'), 'uncommitted work')
    await assert.rejects(assertCleanForRemoval(first), /contains changes/)
    assert.equal(await readFile(join(first.path, 'valuable.txt'), 'utf8'), 'uncommitted work')
    await assertCleanForRemoval(second)
    await removeCheckout(second)
    assert.equal(await checked('git', ['-C', root, 'branch', '--list', 'feature-a']), 'feature-a')
    assert.equal(await checked('git', ['-C', first.path, 'branch', '--show-current']), 'feature/a')
  } finally {
    if (previousState === undefined) delete process.env.WT_STATE_HOME
    else process.env.WT_STATE_HOME = previousState
    if (previousBase === undefined) delete process.env.WORKTREES_BASE
    else process.env.WORKTREES_BASE = previousBase
    await rm(directory, { recursive: true, force: true })
  }
})
