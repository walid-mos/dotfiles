import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { resolveProject } from '../src/identity.ts'
import { openWorkspace } from '../src/lifecycle.ts'
import { checked } from '../src/process.ts'
import { approveRecipe, loadRecipe } from '../src/recipe.ts'

const manifest = { name: 'fixture', packageManager: 'pnpm@11.21.0', engines: { node: '>=24' }, scripts: { dev: 'astro dev' }, dependencies: { astro: '^7.2.2' } }

test('opening an existing branch checks its native commands before touching compute', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wt-feature-trust-'))
  const root = join(directory, 'repo')
  const previous = { WT_STATE_HOME: process.env.WT_STATE_HOME, WORKTREES_BASE: process.env.WORKTREES_BASE, PATH: process.env.PATH }
  process.env.WT_STATE_HOME = join(directory, 'state')
  process.env.WORKTREES_BASE = join(directory, 'worktrees')
  process.env.PATH = `${directory}:${previous.PATH}`
  try {
    await mkdir(root)
    await writeFile(join(directory, 'container'), `#!/bin/sh\ntouch '${directory}/runtime-called'\nexit 99\n`, { mode: 0o755 })
    await checked('git', ['init', '-b', 'main', root])
    await checked('git', ['-C', root, 'config', 'user.name', 'Fixture'])
    await checked('git', ['-C', root, 'config', 'user.email', 'fixture@example.invalid'])
    await writeFile(join(root, 'package.json'), JSON.stringify(manifest))
    await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
    await checked('git', ['-C', root, 'add', '.'])
    await checked('git', ['-C', root, 'commit', '-m', 'baseline'])
    await checked('git', ['-C', root, 'checkout', '-b', 'different-startup'])
    await writeFile(join(root, 'package.json'), JSON.stringify({ ...manifest, scripts: { dev: 'astro dev --host' } }))
    await checked('git', ['-C', root, 'commit', '-am', 'different startup'])
    await checked('git', ['-C', root, 'checkout', 'main'])
    const project = await resolveProject(root)
    await approveRecipe(project, await loadRecipe(project))
    await assert.rejects(openWorkspace(root, 'different-startup', 'headless'), /not trusted/)
    assert.equal(existsSync(join(directory, 'runtime-called')), false)
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(directory, { recursive: true, force: true })
  }
})
