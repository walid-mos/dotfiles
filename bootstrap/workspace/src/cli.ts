#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { openWorkspace, ensureWorkspace, findWorkspace, stopWorkspace, removeWorkspace } from './lifecycle.ts'
import { approveRecipe, loadRecipe } from './recipe.ts'
import { resolveProject } from './identity.ts'
import { execute } from './execution.ts'
import { listWorkspaces, stateRoot } from './store.ts'
import { locateExecutionWorkspace } from './discovery.ts'
import { inspectContainer } from './runtime.ts'
import { updateGateway } from './gateway.ts'

function argument(args: string[], label: string): string {
  const value = args[0]
  if (!value || value.startsWith('-')) throw new Error(`Missing ${label}. Run wt help.`)
  return value
}

function output(value: unknown): void { process.stdout.write(`${JSON.stringify(value)}\n`) }

async function showStatus(): Promise<void> {
  const records = await listWorkspaces()
  for (const workspace of records) {
    const runtime = await inspectContainer(workspace.container)
    output({ id: workspace.id, project: workspace.recipe.project, branch: workspace.branch, phase: workspace.phase, runtime: runtime?.status.state ?? 'absent', path: workspace.path, url: `https://${workspace.hostname}`, error: workspace.error })
  }
}

async function runCommand(args: string[]): Promise<void> {
  const workspace = await findWorkspace(process.cwd(), argument(args, 'workspace ID'))
  if (workspace.phase !== 'ready') throw new Error('Workspace is not ready. Run wt open/ensure first; native fallback is forbidden.')
  const command = argument(args.slice(1), 'command')
  const controller = new AbortController()
  const cancel = () => controller.abort()
  process.once('SIGTERM', cancel)
  process.once('SIGINT', cancel)
  try {
    process.exitCode = await execute(workspace, command, { cwd: process.env.WT_EXEC_CWD ?? workspace.path, signal: controller.signal, env: process.env, onOutput: chunk => process.stdout.write(chunk) })
  } finally { process.removeListener('SIGTERM', cancel); process.removeListener('SIGINT', cancel) }
}

async function shell(args: string[]): Promise<void> {
  const workspace = await findWorkspace(process.cwd(), args[0])
  const ready = await ensureWorkspace(workspace.path)
  if (!process.stdin.isTTY) throw new Error('wt shell requires a terminal. Use wt exec for non-interactive commands.')
  const child = spawn('container', ['exec', '-it', '--workdir', ready.path, ready.container, 'bash', '-l'], { stdio: 'inherit' })
  await new Promise<void>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', code => { process.exitCode = code ?? 1; resolve() })
  })
}

const commands: Record<string, (args: string[]) => Promise<void>> = {
  async open(args) { output(await openWorkspace(process.cwd(), argument(args, 'feature branch'), args.includes('--no-ui') ? 'headless' : 'herdr', args.includes('--no-focus') ? 'preserve' : 'workspace')) },
  async ensure() { output(await ensureWorkspace(process.cwd())) },
  async locate() { output(await locateExecutionWorkspace(process.cwd())) },
  async trust() {
    const project = await resolveProject(process.cwd())
    const recipe = await loadRecipe(project, await realpath(process.cwd()))
    await approveRecipe(project, recipe)
    output({ trusted: project.root, recipe })
  },
  status: showStatus,
  exec: runCommand,
  shell,
  async stop(args) { const workspace = await findWorkspace(process.cwd(), args[0]); await stopWorkspace(workspace); output({ stopped: workspace.id }) },
  async remove(args) {
    const workspace = await findWorkspace(process.cwd(), argument(args, 'feature branch or workspace ID'))
    const confirmation = args[args.indexOf('--confirm') + 1] ?? ''
    await removeWorkspace(workspace, args.includes('--confirm') ? confirmation : '')
    output({ removed: workspace.id, retained: ['branch', 'persistent data'], state: stateRoot() })
  },
  async gateway() { await updateGateway(); output({ gatewayUpdated: true }) },
  async help() {
    process.stdout.write('Studio workspaces — Apple Container\n\nwt trust                     Review/approve the current project recipe\nwt open <feature> [--no-ui]   Create/reuse a ready environment\nwt status                    Inspect workspaces\nwt shell [id]                Enter the feature development terminal\nwt exec <id> <command>       Execute one shell command in Linux\nwt stop <feature|id>         Stop compute; keep files/data\nwt remove <feature|id> --confirm <id>\n                             Remove clean checkout/compute; retain branch/data\nwt gateway                   Refresh private gateway routes\n')
  },
}

const [name = 'help', ...args] = process.argv.slice(2)
try {
  const handler = commands[name]
  if (!handler) throw new Error(`Unknown operation: ${name}. Run wt help.`)
  await handler(args)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`wt: ${message}\n`)
  process.exitCode = message === 'aborted' ? 130 : 1
}
