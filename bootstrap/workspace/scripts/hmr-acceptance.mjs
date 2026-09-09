import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const hostname = process.argv[2]
const checkout = process.argv[3]
if (!hostname?.endsWith('.herdr.test') || !checkout) throw new Error('Pass a private workspace hostname and its disposable checkout path.')
const client = await (await fetch(`https://${hostname}/@vite/client`)).text()
const token = client.match(/const wsToken = "([^"]+)"/)?.[1]
assert.ok(token, 'Vite client must provide a WebSocket token')
await fetch(`https://${hostname}/src/styles.css`)
const socket = new WebSocket(`wss://${hostname}/?token=${token}`, 'vite-hmr')
const path = join(checkout, 'apps/front/src/styles.css')
const original = await readFile(path, 'utf8')
const changes = []
const events = new Promise((resolve, reject) => {
  const deadline = setTimeout(() => reject(new Error(`No host-edit HMR event within 8 seconds; received ${changes.join(', ')}`)), 8000)
  socket.addEventListener('error', event => { clearTimeout(deadline); reject(event) })
  socket.addEventListener('message', async event => {
    const message = JSON.parse(event.data)
    changes.push(message.type)
    if (message.type === 'connected') await writeFile(path, `${original}\n/* workspace HMR acceptance */\n`)
    if (['update', 'full-reload'].includes(message.type)) { clearTimeout(deadline); resolve(message.type) }
  })
})
try {
  console.log('PASS: private HTTPS WebSocket and host-edit HMR:', await events)
} finally {
  await writeFile(path, original)
  socket.close()
}
