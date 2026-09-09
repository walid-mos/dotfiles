import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { quote } from '../src/process.ts'

const RUNNER = fileURLToPath(new URL('../assets/guest-runner.mjs', import.meta.url))

test('a cancellation marker terminates the guest command rather than only its transport', { timeout: 8000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wt-cancel-'))
  const request = join(directory, 'request.json')
  const command = `${quote(process.execPath)} -e 'console.log("RUNNING"); setInterval(() => {}, 1000)'`
  await writeFile(request, JSON.stringify({ command, cwd: directory, env: {} }))
  const child = spawn(process.execPath, [RUNNER, request], { stdio: ['ignore', 'pipe', 'pipe'] })
  const completed = once(child, 'close')
  try {
    const [chunk] = await once(child.stdout, 'data')
    assert.match(String(chunk), /RUNNING/)
    await writeFile(`${request}.cancel`, 'aborted')
    const [code] = await completed
    assert.equal(code, 130)
    assert.equal(await readFile(`${request}.status`, 'utf8'), '130')
    const pid = Number(await readFile(`${request}.pid`, 'utf8'))
    assert.throws(() => process.kill(-pid, 0), { code: 'ESRCH' })
  } finally {
    child.kill('SIGTERM')
    await rm(directory, { recursive: true, force: true })
  }
})

test('a request cancelled before guest startup never executes its command', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wt-precancel-'))
  const request = join(directory, 'request.json')
  await writeFile(request, JSON.stringify({ command: 'touch must-not-exist', cwd: directory, env: {} }))
  await writeFile(`${request}.cancel`, 'aborted')
  const child = spawn(process.execPath, [RUNNER, request])
  try {
    const [code] = await once(child, 'close')
    assert.equal(code, 130)
    await assert.rejects(readFile(join(directory, 'must-not-exist')), { code: 'ENOENT' })
  } finally { await rm(directory, { recursive: true, force: true }) }
})
