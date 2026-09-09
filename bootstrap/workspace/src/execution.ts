import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { containsPath } from './identity.ts'
import { inspectContainer, requireOwner } from './runtime.ts'
import { workspaceFiles } from './store.ts'
import type { Workspace } from './model.ts'

const CANCELLATION_DEADLINE_MS = 5000
const SESSION_KEYS = ['PI_SESSION_ID', 'PI_SESSION_FILE', 'PI_PROVIDER', 'PI_MODEL', 'PI_REASONING_LEVEL']
export interface ExecutionOptions {
  cwd?: string
  signal?: AbortSignal
  timeout?: number
  env?: NodeJS.ProcessEnv
  onOutput?: (chunk: Buffer) => void
}

export async function execute(workspace: Workspace, command: string, options: ExecutionOptions = {}): Promise<number> {
  if (options.signal?.aborted) throw new Error('aborted')
  const cwd = await realpath(options.cwd ?? workspace.path)
  if (!containsPath(workspace.path, cwd)) throw new Error(`Command cwd is outside its workspace: ${cwd}`)
  const runtime = await inspectContainer(workspace.container)
  if (!runtime || runtime.status.state !== 'running') throw new Error('Workspace container is not running. Open it explicitly; host fallback is forbidden.')
  requireOwner(runtime, workspace)
  const directory = join(workspaceFiles(workspace.id), 'runs')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const requestPath = join(directory, `${randomUUID()}.json`)
  const env = Object.fromEntries(SESSION_KEYS.filter(key => options.env?.[key] !== undefined).map(key => [key, options.env![key]]))
  await writeFile(requestPath, JSON.stringify({ command, cwd, env }), { mode: 0o600 })
  try { return await streamGuest(workspace, requestPath, options) }
  finally { await removeRequest(requestPath) }
}

function streamGuest(workspace: Workspace, path: string, options: ExecutionOptions): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('container', ['exec', workspace.container, 'node', '/opt/studio-workspace/guest-runner.mjs', path], { stdio: ['ignore', 'pipe', 'pipe'] })
    let failure: string | undefined
    let cancellationDeadline: NodeJS.Timeout | undefined
    const cancel = (reason: string) => {
      if (failure) return
      failure = reason
      void writeFile(`${path}.cancel`, reason).catch(reject)
      cancellationDeadline = setTimeout(() => child.kill('SIGKILL'), CANCELLATION_DEADLINE_MS)
    }
    const abort = () => cancel('aborted')
    const timeout = options.timeout ? setTimeout(() => cancel(`timeout:${options.timeout}`), options.timeout * 1000) : undefined
    const finish = () => {
      if (timeout) clearTimeout(timeout)
      if (cancellationDeadline) clearTimeout(cancellationDeadline)
      options.signal?.removeEventListener('abort', abort)
    }
    child.stdout.on('data', (chunk: Buffer) => options.onOutput?.(chunk))
    child.stderr.on('data', (chunk: Buffer) => options.onOutput?.(chunk))
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()
    child.on('error', error => { finish(); reject(error) })
    child.on('close', async code => {
      finish()
      if (failure) { reject(new Error(await cancellationResult(path, failure))); return }
      resolve(code ?? 1)
    })
  })
}

async function cancellationResult(path: string, failure: string): Promise<string> {
  const status = await readFile(`${path}.status`, 'utf8').catch(() => '')
  return status === '130' ? failure : `Guest cancellation was not confirmed (${failure}). Stop the workspace before retrying; request retained at ${path}.`
}

async function removeRequest(path: string): Promise<void> {
  const hasCompletion = await readFile(`${path}.status`).then(() => true, () => false)
  if (!hasCompletion) return
  await Promise.all(['', '.pid', '.cancel', '.status'].map(suffix => unlink(`${path}${suffix}`).catch(() => undefined)))
}
