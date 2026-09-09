import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))

async function withDirectory(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'wt-discovery-'))
  try { await run(root) }
  finally { await rm(root, { recursive: true, force: true }) }
}

function locate(cwd: string, root: string) {
  return spawnSync(process.execPath, [cli, 'locate'], { cwd, env: { ...process.env, WT_STATE_HOME: join(root, 'state') }, encoding: 'utf8' })
}

test('Pi discovery blocks native execution from an unmanaged pnpm application without .workspace.json', async () => {
  await withDirectory(async root => {
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'pnpm something' } }))
    await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
    const nested = join(root, 'apps', 'front', 'src')
    await mkdir(nested, { recursive: true })
    const result = locate(nested, root)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /native execution is blocked/)
    assert.equal(result.stdout, '')
  })
})

test('ordinary host-administration directories still return no managed workspace', async () => {
  await withDirectory(async root => {
    const result = locate(root, root)
    assert.equal(result.status, 0)
    assert.equal(result.stdout.trim(), 'null')
  })
})

test('malformed application manifests do not silently switch execution to macOS', async () => {
  await withDirectory(async root => {
    await writeFile(join(root, 'package.json'), '{ broken')
    await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
    const result = locate(root, root)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Invalid package.json/)
  })
})
