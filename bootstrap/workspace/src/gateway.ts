import { mkdir, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { listWorkspaces, stateRoot } from './store.ts'
import { inspectContainer, requireOwner } from './runtime.ts'
import { APPLICATION_SOCKET } from './model.ts'
import { checked, run } from './process.ts'
import { withLock } from './lock.ts'

export const GATEWAY_PORT = 8443
export const GATEWAY_ADMIN = 'http://127.0.0.1:2019'

export function gatewayRoot(): string { return join(stateRoot(), 'gateway') }

export function renderGateway(routes: { hostname: string; upstream?: string }[]): string {
  const sites = routes.length ? routes : [{ hostname: 'welcome.herdr.test' }]
  const blocks = sites.map(route => {
    if (!/^[a-z0-9.-]+\.herdr\.test$/.test(route.hostname)) throw new Error(`Invalid private hostname: ${route.hostname}`)
    if (route.upstream && (!route.upstream.startsWith('/') || /[\n\r\0]/.test(route.upstream))) throw new Error('Invalid gateway endpoint.')
    const handler = route.upstream ? `reverse_proxy ${JSON.stringify(`unix/${route.upstream}`)}` : 'respond "Workspace stopped or unavailable. Open it with wt open." 503'
    return `https://${route.hostname}:${GATEWAY_PORT} {\n  tls internal\n  ${handler}\n}`
  })
  return `{\n  admin 127.0.0.1:2019\n  default_bind 127.0.0.1\n  auto_https disable_redirects\n  skip_install_trust\n  servers {\n    protocols h1 h2\n  }\n}\n\n${blocks.join('\n\n')}\n`
}

export async function updateGateway(): Promise<void> {
  await withLock('gateway', async () => {
    const records = (await listWorkspaces()).filter(workspace => workspace.phase !== 'removed')
    const routes = await Promise.all(records.map(async workspace => {
      const runtime = workspace.phase === 'ready' ? await inspectContainer(workspace.container) : undefined
      if (runtime) requireOwner(runtime, workspace)
      const upstream = runtime?.status.state === 'running' ? join(stateRoot(), 'files', workspace.id, APPLICATION_SOCKET) : undefined
      return { hostname: workspace.hostname, upstream }
    }))
    const directory = gatewayRoot()
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const path = join(directory, 'Caddyfile')
    const staging = join(directory, `Caddyfile.${randomUUID()}`)
    await writeFile(staging, renderGateway(routes), { mode: 0o600 })
    await checked('caddy', ['adapt', '--config', staging, '--adapter', 'caddyfile'])
    await rename(staging, path)
    const active = await run('curl', ['--noproxy', '*', '--max-time', '1', '--fail', '--silent', `${GATEWAY_ADMIN}/config/`])
    if (active.code === 0) await checked('caddy', ['reload', '--config', path, '--adapter', 'caddyfile'])
  })
}
