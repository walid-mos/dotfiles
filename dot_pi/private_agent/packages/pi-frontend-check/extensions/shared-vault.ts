import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { Type } from 'typebox'
import { Value } from 'typebox/value'

import type { Static } from 'typebox'

const run = promisify(execFile)
const broker = join(
	homedir(),
	'.pi/agent/packages/pi-frontend-check/shared-web-logins/broker.py',
)
const HANDLE_PATTERN = '^iw:[a-f0-9]{32}$'
const handlePattern = new RegExp(HANDLE_PATTERN)
const MAX_BROKER_OUTPUT_BYTES = 524_288

const metadataSchema = Type.Object({
	handle: Type.String({ pattern: HANDLE_PATTERN }),
	origin: Type.String(),
	identifier: Type.String(),
	label: Type.String(),
	identifier_type: Type.String(),
	has_otp: Type.Boolean(),
})
const loginSchema = Type.Object({
	...metadataSchema.properties,
	password: Type.String(),
	otp_secret: Type.Optional(Type.String()),
})
export type SharedLoginMetadata = Static<typeof metadataSchema>
export const sharedLoginHandleSchema = metadataSchema.properties.handle
type SharedLogin = Static<typeof loginSchema>

async function callBroker(
	action: 'list' | 'read',
	handle?: string,
	signal?: AbortSignal,
): Promise<unknown> {
	try {
		const { stdout } = await run(
			'/usr/bin/python3',
			[broker, action, ...(handle ? [handle] : [])],
			{
				timeout: 30_000,
				maxBuffer: MAX_BROKER_OUTPUT_BYTES,
				signal,
				env: {
					HOME: homedir(),
					PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
					TMPDIR:
						process.env.TMPDIR ??
						join(
							homedir(),
							'.hermes/profiles/factory/cache/scratch',
						),
					USER: process.env.USER ?? '',
					LOGNAME: process.env.LOGNAME ?? '',
				},
			},
		)
		return JSON.parse(stdout)
	} catch {
		// Never include child stderr, stdout or the error cause: `read` carries a password.
		throw new Error(
			'Shared web-login vault unavailable. Do not re-enter the password yet.',
		)
	}
}

export async function listSharedLogins(
	signal?: AbortSignal,
): Promise<SharedLoginMetadata[]> {
	const records = await callBroker('list', undefined, signal)
	if (
		!Array.isArray(records) ||
		!records.every((record: unknown) => Value.Check(metadataSchema, record))
	)
		throw new Error('Shared web-login vault returned invalid metadata.')
	return records
}

export async function readSharedLogin(
	handle: string,
	signal?: AbortSignal,
): Promise<SharedLogin> {
	if (!handlePattern.test(handle))
		throw new Error('Invalid shared login handle.')
	const record = await callBroker('read', handle, signal)
	if (!Value.Check(loginSchema, record) || record.handle !== handle)
		throw new Error('Shared web-login vault returned an invalid record.')
	return record
}
