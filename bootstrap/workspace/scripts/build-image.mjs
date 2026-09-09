import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const assets = join(dirname(fileURLToPath(import.meta.url)), '../assets')
const image = 'studio-dev:node24-pnpm11'
const state = join(process.env.WT_STATE_HOME ?? join(homedir(), '.local/share/studio-workspace'), 'images')
const inputs = ['Containerfile', 'guest-runner.mjs', 'fitapp-dev.sh', 'serve.sh']
const hash = createHash('sha256')
for (const input of inputs) hash.update(input).update(await readFile(join(assets, input)))
const revision = hash.digest('hex')
await mkdir(state, { recursive: true, mode: 0o700 })
const stamp = join(state, 'node24-pnpm11.sha256')
const previous = await readFile(stamp, 'utf8').catch(() => '')
const exists = spawnSync('container', ['image', 'inspect', image], { stdio: 'ignore' }).status === 0
if (exists && previous === revision) {
  console.log(`Development image already current: ${image}`)
} else {
  const result = spawnSync('container', ['build', '--cpus', '2', '--memory', '2G', '--progress', 'plain', '-t', image, '-f', join(assets, 'Containerfile'), assets], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`Apple Container image build failed: ${result.status}`)
  await writeFile(stamp, revision, { mode: 0o600 })
}
