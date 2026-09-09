import { createWriteStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { execute } from './execution.ts'
import { checked, run, quote } from './process.ts'
import { workspaceFiles } from './store.ts'
import { READINESS_TIMEOUT_MS, POLL_INTERVAL_MS } from './model.ts'
import type { Workspace } from './model.ts'

const PREPARATION_TIMEOUT_SECONDS = 900

export async function prepareProject(workspace: Workspace): Promise<void> {
  const log = createWriteStream(join(workspaceFiles(workspace.id), 'prepare.log'), { flags: 'a', mode: 0o600 })
  try {
    for (const command of workspace.recipe.prepare) {
      process.stderr.write(`Preparing ${workspace.branch}: ${command}\n`)
      const code = await execute(workspace, command, { timeout: PREPARATION_TIMEOUT_SECONDS, onOutput: chunk => log.write(chunk) })
      if (code !== 0) throw new Error(`Preparation failed (${code}). See ${workspaceFiles(workspace.id)}/prepare.log`)
    }
  } finally { log.end() }
}

export async function ensureApplication(workspace: Workspace): Promise<void> {
  if (await isApplicationRunning(workspace)) return waitForApplication(workspace)
  const log = join(workspaceFiles(workspace.id), 'application.log')
  const pid = join(workspaceFiles(workspace.id), 'application.pid')
  const launch = `setsid bash /opt/studio-workspace/serve.sh ${quote(workspace.recipe.start)} > ${quote(log)} 2>&1 < /dev/null & echo $! > ${quote(pid)}`
  await checked('container', ['exec', '--detach', '--workdir', workspace.path, workspace.container, 'bash', '-lc', launch])
  await waitForApplication(workspace)
}

export async function isApplicationRunning(workspace: Workspace): Promise<boolean> {
  const pid = (await readFile(join(workspaceFiles(workspace.id), 'application.pid'), 'utf8').catch(() => '')).trim()
  if (!/^[1-9][0-9]*$/.test(pid)) return false
  const result = await run('container', ['exec', workspace.container, 'bash', '-lc', `test -r /proc/${pid}/cmdline && kill -0 ${pid}`])
  return result.code === 0
}

async function waitForApplication(workspace: Workspace): Promise<void> {
  const deadline = Date.now() + READINESS_TIMEOUT_MS
  const probe = `fetch('http://127.0.0.1:${workspace.recipe.port}', {signal: AbortSignal.timeout(1000)}).then(r => process.exit(r.status < 500 ? 0 : 1)).catch(() => process.exit(1))`
  while (Date.now() < deadline) {
    const result = await run('container', ['exec', workspace.container, 'node', '-e', probe], { timeout: 3000 })
    if (result.code === 0) return
    await delay(POLL_INTERVAL_MS)
  }
  throw new Error(`Application did not become ready. See ${workspaceFiles(workspace.id)}/application.log`)
}
