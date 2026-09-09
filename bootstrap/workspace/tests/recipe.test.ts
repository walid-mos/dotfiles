import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { approveRecipe, parseRecipe, requireTrustedRecipe, safeRelative } from '../src/recipe.ts'

const baseline = { version: 1, project: 'app', image: 'node:24', start: 'pnpm dev', port: 3000 }

test('invalid/unknown config cannot silently disable validation or add runtime mounts', () => {
  assert.throws(() => parseRecipe(JSON.stringify({ ...baseline, runArgs: ['--privileged'] })), /Unsupported/)
  assert.throws(() => parseRecipe(JSON.stringify({ ...baseline, port: -1 })), /port/)
  assert.throws(() => parseRecipe(JSON.stringify({ ...baseline, version: 99 })), /version/)
})

test('persistent and fingerprint inputs cannot escape the checkout', () => {
  assert.throws(() => safeRelative('../../.ssh'), /Unsafe/)
  assert.throws(() => safeRelative('/etc/passwd'), /Unsafe/)
  assert.throws(() => safeRelative('.git/config'), /Unsafe/)
})

test('project config cannot override manager-owned environment variables', () => {
  assert.throws(() => parseRecipe(JSON.stringify({ ...baseline, env: { WT_URL: 'unexpected' } })), /reserved/)
})

test('approval is scoped to exact recipe content and project identity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wt-trust-test-'))
  const previous = process.env.WT_STATE_HOME
  process.env.WT_STATE_HOME = directory
  const project = { id: 'repo-one', root: '/repo', commonDir: '/repo/.git' }
  const recipe = parseRecipe(JSON.stringify(baseline))
  try {
    await assert.rejects(requireTrustedRecipe(project, recipe), /not trusted/)
    await approveRecipe(project, recipe)
    await requireTrustedRecipe(project, recipe)
    await assert.rejects(requireTrustedRecipe(project, { ...recipe, start: 'malicious-command' }), /not trusted/)
    await assert.rejects(requireTrustedRecipe({ ...project, id: 'repo-two' }, recipe), /not trusted/)
  } finally {
    if (previous === undefined) delete process.env.WT_STATE_HOME
    else process.env.WT_STATE_HOME = previous
    await rm(directory, { recursive: true, force: true })
  }
})
