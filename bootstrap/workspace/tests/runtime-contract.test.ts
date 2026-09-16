import assert from 'node:assert/strict'
import { test } from 'node:test'
import { containerArguments, requireOwner } from '../src/runtime.ts'
import { renderGateway } from '../src/gateway.ts'
import { parseRecipe } from '../src/recipe.ts'
import type { Workspace } from '../src/model.ts'

const workspace: Workspace = {
  version: 1, id: '0123456789abcdef', project: { id: 'repo', root: '/host/main', commonDir: '/host/main/.git' },
  branch: 'feature', path: '/host/worktrees/feature', container: 'wt-0123456789abcdef',
  recipe: parseRecipe(JSON.stringify({ version: 1, project: 'app', image: 'node:24', start: 'pnpm dev', port: 3000 })),
  revision: 'revision', preparation: null, phase: 'ready', hostname: 'feature.app.herdr.test',
}

test('container mounts preserve worktree and common Git metadata absolute paths', () => {
  const args = containerArguments(workspace, {})
  assert.ok(args.includes('type=bind,source=/host/worktrees/feature,target=/host/worktrees/feature'))
  assert.ok(args.includes('type=bind,source=/host/main/.git,target=/host/main/.git'))
  assert.equal(args.includes('--publish'), false)
  assert.equal(args.includes('--privileged'), false)
})

test('container ownership mismatch cannot be bypassed by matching its name', () => {
  assert.throws(() => requireOwner({ configuration: { labels: { 'dev.herdr.workspace': 'different-id' }, image: { reference: 'node:24' } }, status: { state: 'running', networks: [] } }, workspace), /unowned/)
})

test('stopped features keep explicit unavailable routes without stale upstreams', () => {
  const config = renderGateway([{ hostname: 'a.app.herdr.test', upstream: '/workspace-state/files/a/application.sock' }, { hostname: 'b.app.herdr.test' }])
  assert.match(config, /reverse_proxy "unix\/\/workspace-state\/files\/a\/application\.sock"/)
  assert.match(config, /https:\/\/b\.app\.herdr\.test:8443 \{\n  tls internal\n  respond .* 503/)
})

test('gateway host/upstream fields cannot inject server configuration', () => {
  assert.throws(() => renderGateway([{ hostname: 'bad\nfile_server.herdr.test' }]), /Invalid/)
  assert.throws(() => renderGateway([{ hostname: 'a.app.herdr.test', upstream: '127.0.0.1:3000\nfile_server' }]), /Invalid/)
})
