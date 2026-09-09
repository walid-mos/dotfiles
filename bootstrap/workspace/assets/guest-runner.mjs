import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const requestPath = process.argv[2]
if (!requestPath) throw new Error('A workspace execution request path is required.')
const request = JSON.parse(readFileSync(requestPath, 'utf8'))
const cancelPath = `${requestPath}.cancel`
const statusPath = `${requestPath}.status`
const CANCEL_INTERVAL_MS = 100
const KILL_GRACE_MS = 1000

if (existsSync(cancelPath)) process.exit(130)
const child = spawn('bash', ['-lc', request.command], {
  cwd: request.cwd, env: { ...process.env, ...request.env },
  detached: true, stdio: ['ignore', 'inherit', 'inherit'],
})
writeFileSync(`${requestPath}.pid`, String(child.pid), { mode: 0o600 })
let isCancelling = false
let killTimer

function signalGroup(signal) {
  try { process.kill(-child.pid, signal) }
  catch (error) { if (error.code !== 'ESRCH') throw error }
}

function cancel() {
  if (isCancelling) return
  isCancelling = true
  signalGroup('SIGTERM')
  killTimer = setTimeout(() => signalGroup('SIGKILL'), KILL_GRACE_MS)
}

const watcher = setInterval(() => { if (existsSync(cancelPath)) cancel() }, CANCEL_INTERVAL_MS)
process.on('SIGTERM', cancel)
process.on('SIGINT', cancel)
child.on('error', error => {
  console.error(error.message)
  writeFileSync(statusPath, '127')
  process.exit(127)
})
child.on('close', code => {
  clearInterval(watcher)
  // Kill any leftover children before reporting cancellation as completed.
  if (isCancelling) signalGroup('SIGKILL')
  if (killTimer) clearTimeout(killTimer)
  const status = isCancelling ? 130 : (code ?? 1)
  writeFileSync(statusPath, String(status))
  process.exit(status)
})
