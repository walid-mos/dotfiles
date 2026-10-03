/** A kernel-owned loopback port elects one writer and releases on process exit. */
import { createConnection, createServer } from 'node:net'

import { serverKey } from './storage.ts'

const PORT_BASE = 49_152
const PORT_RANGE = 16_384
const HASH_DIGITS = 8
const HEX_RADIX = 16
const OWNER_TIMEOUT_MS = 1_000
const HOST = '127.0.0.1'
const identity = `pi-task-names/v1:${serverKey}`
const port =
	PORT_BASE +
	(Number.parseInt(serverKey.slice(0, HASH_DIGITS), HEX_RADIX) % PORT_RANGE)

export interface NamingOwnership {
	release(): Promise<void>
}

async function verifyOwner(): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const connection = createConnection({ host: HOST, port })
		let received = ''
		connection.setEncoding('utf8')
		connection.setTimeout(OWNER_TIMEOUT_MS, () =>
			connection.destroy(
				new Error('Naming coordinator handshake timed out'),
			),
		)
		connection.on('error', reject)
		connection.on('data', chunk => {
			received += chunk
			if (received.length > identity.length)
				connection.destroy(
					new Error(`Port ${port} belongs to another application`),
				)
		})
		connection.on('end', () => {
			if (received === identity) resolve()
			else
				reject(
					new Error(
						`Port ${port} belongs to another application; task naming was not started`,
					),
				)
		})
	})
}

export async function acquireNaming(): Promise<NamingOwnership | undefined> {
	const server = createServer(connection => {
		connection.on('error', () => connection.destroy())
		connection.setTimeout(OWNER_TIMEOUT_MS, () => connection.destroy())
		connection.end(identity)
	})
	try {
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject)
			server.listen({ host: HOST, port, exclusive: true }, resolve)
		})
	} catch (cause) {
		if (
			!cause ||
			typeof cause !== 'object' ||
			Reflect.get(cause, 'code') !== 'EADDRINUSE'
		)
			throw cause
		await verifyOwner()
		return undefined
	}
	server.unref()
	return {
		release: () =>
			new Promise<void>((resolve, reject) => {
				server.close(error => {
					if (error) reject(error)
					else resolve()
				})
			}),
	}
}
