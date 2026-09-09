import assert from 'node:assert/strict'
import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { loadWorkspace, workspaceFiles } from '../src/store.ts'
import { execute } from '../src/execution.ts'
import { checked } from '../src/process.ts'
import { openWorkspace, stopWorkspace } from '../src/lifecycle.ts'
import type { Workspace } from '../src/model.ts'

const [firstId, secondId] = process.argv.slice(2)
if (!firstId || !secondId) throw new Error('Pass two explicitly disposable workspace IDs.')
const first = await loadWorkspace(firstId)
const second = await loadWorkspace(secondId)
if (!first || !second || first.id === second.id) throw new Error('Two distinct managed workspaces are required.')
if (!['dev-a', 'dev-b'].includes(first.branch) || !['dev-a', 'dev-b'].includes(second.branch)) throw new Error('This prototype test is restricted to the dev-a/dev-b fixtures.')

async function shell(workspace: Workspace, command: string): Promise<string> {
  const chunks: Buffer[] = []
  const code = await execute(workspace, command, { timeout: 60, onOutput: chunk => chunks.push(chunk) })
  const output = Buffer.concat(chunks).toString()
  assert.equal(code, 0, output)
  return output
}

async function database(workspace: Workspace, sql: string): Promise<unknown> {
  const command = `pnpm --filter @fitapp/api exec wrangler d1 execute DB --local --config wrangler.dev.jsonc --json --command ${JSON.stringify(sql)}`
  return JSON.parse(await shell(workspace, command))
}

async function cancellation(workspace: Workspace): Promise<void> {
  const controller = new AbortController()
  const command = 'node -e \'require("fs").writeFileSync(process.env.TMPDIR+"/acceptance-child.pid",String(process.pid)); console.log("READY"); setInterval(()=>{},1000)\''
  await assert.rejects(execute(workspace, command, {
    signal: controller.signal,
    onOutput: chunk => { if (chunk.toString().includes('READY')) controller.abort() },
  }), /aborted/)
  const pid = Number(await readFile(join(workspaceFiles(workspace.id), 'tmp/acceptance-child.pid'), 'utf8'))
  const status = await shell(workspace, `if kill -0 ${pid} 2>/dev/null; then echo RUNNING; else echo TERMINATED; fi`)
  assert.equal(status.trim(), 'TERMINATED')
}

assert.equal((await shell(first, 'uname -s; pwd')).trim(), `Linux\n${first.path}`)
await shell(first, 'git status --porcelain; git diff --stat')
await shell(second, 'git status --porcelain; git diff --stat')
await shell(first, 'printf shared-file-proof > .workspace-acceptance.txt')
assert.equal(await readFile(join(first.path, '.workspace-acceptance.txt'), 'utf8'), 'shared-file-proof')
await unlink(join(first.path, '.workspace-acceptance.txt'))
console.log('PASS: Linux, same absolute paths, Git and host-visible writes')

await cancellation(first)
await assert.rejects(execute(first, 'node -e "setInterval(()=>{},1000)"', { timeout: 1 }), /timeout:1/)
console.log('PASS: guest cancellation and timeout')

await database(first, 'CREATE TABLE IF NOT EXISTS workspace_acceptance(marker TEXT); DELETE FROM workspace_acceptance; INSERT INTO workspace_acceptance VALUES (\'only-a\');')
const isolated = JSON.stringify(await database(second, "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='workspace_acceptance';"))
assert.match(isolated, /"count":0/)
console.log('PASS: D1 state is independent')

for (const workspace of [first, second]) {
  const code = await checked('curl', ['--noproxy', '*', '--silent', '--show-error', '--output', '/dev/null', '--write-out', '%{http_code}', `https://${workspace.hostname}`])
  assert.equal(code, '200')
}
console.log('PASS: both normal private HTTPS URLs on the same application port')

await stopWorkspace(first)
await assert.rejects(execute(first, 'uname -s'), /not running/)
assert.equal(await checked('curl', ['--noproxy', '*', '--silent', '--output', '/dev/null', '--write-out', '%{http_code}', `https://${first.hostname}`]), '503')
assert.equal((await shell(second, 'uname -s')).trim(), 'Linux')
const reopened = await openWorkspace(first.project.root, first.branch, 'herdr', 'preserve')
const retained = JSON.stringify(await database(reopened, 'SELECT marker FROM workspace_acceptance;'))
assert.match(retained, /"marker":"only-a"/)
await database(reopened, 'DROP TABLE workspace_acceptance;')
console.log('PASS: stop blocks host fallback, leaves sibling alive, and reopening preserves D1')
