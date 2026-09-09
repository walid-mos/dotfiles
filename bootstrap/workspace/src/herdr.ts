import { checked } from './process.ts'
import { saveWorkspace } from './store.ts'
import type { Workspace } from './model.ts'

interface HerdrPane {
  pane_id: string
  agent_status?: string
  agent?: string
  agent_session?: { agent: string; source: string; kind: string; value: string }
}
interface HerdrResult {
  workspace?: { workspace_id: string }
  root_pane?: HerdrPane
  pane?: HerdrPane
  panes?: HerdrPane[]
  workspaces?: { workspace_id: string }[]
  process_info?: { shell_pid: number; foreground_process_group_id: number; foreground_processes: { argv?: string[] }[] }
}
type Focus = 'preserve' | 'workspace'

async function request(args: string[], socket?: string): Promise<HerdrResult> {
  const env = socket ? { ...process.env, HERDR_SOCKET_PATH: socket } : process.env
  const source = await checked('herdr', args, { env })
  const acknowledgement = ['pane run', 'workspace focus', 'workspace close'].includes(args.slice(0, 2).join(' '))
  if (!source && acknowledgement) return {}
  const response = JSON.parse(source) as { error?: unknown; result: HerdrResult }
  if (response.error) throw new Error(`Herdr: ${JSON.stringify(response.error)}`)
  return response.result
}

export async function attachHerdr(workspace: Workspace, focus: Focus = 'workspace'): Promise<Workspace> {
  if (process.env.HERDR_ENV !== '1' || !process.env.HERDR_SOCKET_PATH) throw new Error('Run wt open inside Herdr, or use --no-ui for headless preparation.')
  const socket = process.env.HERDR_SOCKET_PATH
  const associated = await ensureAssociation(workspace, socket)
  await ensureAgent(associated)
  if (focus === 'workspace') await request(['workspace', 'focus', associated.herdr!.workspace], socket)
  return associated
}

async function ensureAssociation(workspace: Workspace, socket: string): Promise<Workspace> {
  const topology = await request(['workspace', 'list'], socket)
  if (workspace.herdr?.socket === socket && topology.workspaces?.some(item => item.workspace_id === workspace.herdr!.workspace)) {
    return ensureTerminal(workspace)
  }
  const created = await request(['workspace', 'create', '--cwd', workspace.path, '--label', `${workspace.recipe.project} / ${workspace.branch}`, '--env', `WT_WORKSPACE_ID=${workspace.id}`, '--no-focus'], socket)
  if (!created.workspace || !created.root_pane) throw new Error('Herdr workspace creation did not return its workspace and root pane.')
  const associated: Workspace = { ...workspace, herdr: { socket, workspace: created.workspace.workspace_id, agentPane: created.root_pane.pane_id } }
  await saveWorkspace(associated)
  return ensureTerminal(associated)
}

async function ensureTerminal(workspace: Workspace): Promise<Workspace> {
  const association = workspace.herdr!
  const listing = await request(['pane', 'list', '--workspace', association.workspace], association.socket)
  if (association.terminalPane && listing.panes?.some(pane => pane.pane_id === association.terminalPane)) {
    await attachTerminalWhenIdle(workspace, association.terminalPane)
    return workspace
  }
  const terminal = await request(['pane', 'split', '--pane', association.agentPane, '--direction', 'right', '--cwd', workspace.path, '--no-focus'], association.socket)
  if (!terminal.pane) throw new Error('Herdr split did not return a pane.')
  const associated: Workspace = { ...workspace, herdr: { ...association, terminalPane: terminal.pane.pane_id } }
  await saveWorkspace(associated)
  await request(['pane', 'run', terminal.pane.pane_id, 'wt', 'shell', workspace.id], association.socket)
  return associated
}

async function attachTerminalWhenIdle(workspace: Workspace, pane: string): Promise<void> {
  const status = await request(['pane', 'process-info', '--pane', pane], workspace.herdr!.socket)
  const process = status.process_info
  if (!process) throw new Error('Cannot inspect the managed terminal; refusing to send blind terminal input.')
  const isAttached = process.foreground_processes.some(child => child.argv?.includes(workspace.container))
  if (isAttached) return
  if (process.shell_pid !== process.foreground_process_group_id) throw new Error('Managed development terminal is occupied by another command. Finish it before reopening the workspace.')
  await request(['pane', 'run', pane, 'wt', 'shell', workspace.id], workspace.herdr!.socket)
}

async function ensureAgent(workspace: Workspace): Promise<void> {
  const association = workspace.herdr!
  const listing = await request(['pane', 'list', '--workspace', association.workspace], association.socket)
  const pane = listing.panes?.find(candidate => candidate.pane_id === association.agentPane)
  if (pane?.agent === 'pi') return
  if (pane?.agent) throw new Error('The workspace agent pane is occupied by another agent; refusing to replace it.')
  const session = pane?.agent_session
  const resume = session?.agent === 'pi' && session.source === 'herdr:pi' ? ['--session', session.value] : ['--continue']
  await request(['agent', 'start', `pi-${workspace.id}`, '--kind', 'pi', '--pane', association.agentPane, '--', '--no-approve', ...resume], association.socket)
}

export async function requireIdleAgents(workspace: Workspace): Promise<void> {
  if (!workspace.herdr) return
  const { socket, workspace: id } = workspace.herdr
  const topology = await request(['workspace', 'list'], socket)
  if (!topology.workspaces?.some(item => item.workspace_id === id)) return
  const listing = await request(['pane', 'list', '--workspace', id], socket)
  const busy = listing.panes?.filter(pane => pane.agent && !['idle', 'done'].includes(pane.agent_status ?? 'unknown')) ?? []
  if (busy.length) throw new Error(`Workspace has working/blocked/unknown agents: ${busy.map(pane => pane.pane_id).join(', ')}. Settle them before stopping/removing it.`)
}

export async function closeHerdr(workspace: Workspace): Promise<void> {
  if (!workspace.herdr) return
  const { socket, workspace: id } = workspace.herdr
  const topology = await request(['workspace', 'list'], socket)
  if (topology.workspaces?.some(item => item.workspace_id === id)) await request(['workspace', 'close', id], socket)
}
