import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { loadRecipe, recipeRevision } from '../src/recipe.ts'

async function writeProjectFile(root: string, path: string, content: unknown): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), typeof content === 'string' ? content : JSON.stringify(content))
}

async function withProject(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'wt-default-'))
  try {
    await writeProjectFile(root, 'package.json', {
      name: 'another-project', packageManager: 'pnpm@11.21.0', engines: { node: '>=24' }, scripts: { dev: 'turbo run dev' },
    })
    await writeProjectFile(root, 'pnpm-lock.yaml', 'lockfileVersion: 9.0\n')
    await writeProjectFile(root, 'apps/site/package.json', { name: '@another/site', scripts: { dev: 'astro dev' }, dependencies: { astro: '^7.2.2' } })
    await run(root)
  } finally { await rm(root, { recursive: true, force: true }) }
}

function project(root: string) { return { root, id: 'disposable', commonDir: join(root, '.git') } }

test('an ordinary pnpm/Astro project opens without a workspace recipe or startup wrapper', async () => {
  await withProject(async root => {
    const recipe = await loadRecipe(project(root))
    assert.equal(recipe.project, 'another-project')
    assert.equal(recipe.start, 'pnpm dev')
    assert.equal(recipe.port, 4321)
    assert.deepEqual(recipe.prepare, ['pnpm install --frozen-lockfile'])
    assert.deepEqual(recipe.persistPaths, [])
  })
})

test('native Wrangler config supplies local D1 preparation and persistence without project-name assumptions', async () => {
  await withProject(async root => {
    await writeProjectFile(root, 'apps/backend/package.json', { name: '@another/backend', scripts: { dev: 'wrangler dev --config wrangler.dev.jsonc' } })
    await writeProjectFile(root, 'apps/backend/wrangler.dev.jsonc', `{
      // Native development configuration, including trailing commas.
      "name": "another-api",
      "d1_databases": [{ "binding": "CATALOG", "migrations_dir": "migrations", }],
    }`)
    await writeProjectFile(root, 'apps/site/wrangler.dev.jsonc', '{"name":"another-site"}')
    const recipe = await loadRecipe(project(root))
    assert.deepEqual(recipe.persistPaths, ['apps/backend/.wrangler', 'apps/site/.wrangler'])
    assert.equal(recipe.prepare[1], "pnpm --dir 'apps/backend' exec wrangler d1 migrations apply 'CATALOG' --local --config wrangler.dev.jsonc")
    assert.ok(recipe.prepareInputs.includes('apps/backend/migrations'))
    assert.ok(recipe.prepareInputs.includes('apps/backend/wrangler.dev.jsonc'))
    assert.equal(recipe.prepare.some(command => command.includes('--remote')), false)
  })
})

test('a changed package command changes the approval revision', async () => {
  await withProject(async root => {
    const previous = await loadRecipe(project(root))
    await writeProjectFile(root, 'apps/site/package.json', { name: '@another/site', scripts: { dev: 'astro dev --host' }, dependencies: { astro: '^7.2.2' } })
    assert.notEqual(recipeRevision(await loadRecipe(project(root))), recipeRevision(previous))
  })
})

test('shared package commands and workspace membership are included in approval', async () => {
  await withProject(async root => {
    const previous = recipeRevision(await loadRecipe(project(root)))
    await writeProjectFile(root, 'packages/tasks/package.json', { scripts: { dev: 'node background-task.mjs' } })
    const withTask = recipeRevision(await loadRecipe(project(root)))
    assert.notEqual(withTask, previous)
    await writeProjectFile(root, 'pnpm-workspace.yaml', 'packages:\n  - apps/*\n  - packages/*\n')
    assert.notEqual(recipeRevision(await loadRecipe(project(root))), withTask)
  })
})

test('feature-native settings are used rather than silently inheriting main-checkout defaults', async () => {
  await withProject(async root => {
    const checkout = join(root, 'feature')
    await writeProjectFile(checkout, 'package.json', { name: 'feature-project', packageManager: 'pnpm@11.21.0', engines: { node: '>=24' }, scripts: { dev: 'astro dev' }, dependencies: { astro: '^7.2.2' } })
    await writeProjectFile(checkout, 'pnpm-lock.yaml', 'lockfileVersion: 9.0\n')
    assert.equal((await loadRecipe(project(root), checkout)).project, 'feature-project')
  })
})

test('malformed native config and escaping migration paths fail instead of dropping data preparation', async () => {
  await withProject(async root => {
    const config = 'apps/site/wrangler.dev.jsonc'
    await writeProjectFile(root, config, '{ broken')
    await assert.rejects(loadRecipe(project(root)), /Invalid.*wrangler/)
    await writeProjectFile(root, config, { d1_databases: [{ binding: 'DB', migrations_dir: '../../outside' }] })
    await assert.rejects(loadRecipe(project(root)), /Unsafe/)
  })
})

test('unsupported package managers and ambiguous frontends fail with explicit guidance', async () => {
  await withProject(async root => {
    await writeProjectFile(root, 'apps/second/package.json', { scripts: { dev: 'astro dev' }, dependencies: { astro: '^7.2.2' } })
    await assert.rejects(loadRecipe(project(root)), /one Astro/)
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    await writeProjectFile(root, 'package.json', { ...manifest, packageManager: 'npm@11.0.0' })
    await assert.rejects(loadRecipe(project(root)), /pnpm 11/)
  })
})
