/** Infisical REST access as the user's CLI session; shared by the agent-security scripts. The token lives in the calling process only. */
import { spawnSync } from 'node:child_process'

import type { SecretLocation } from './infisical-target.ts'

export const API = 'https://app.infisical.com/api/v3/secrets/raw'
export const TIMEOUT_MS = 30_000

export function sessionToken(): string {
	const result = spawnSync('infisical', ['user', 'get', 'token', '--plain'], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore'],
		timeout: TIMEOUT_MS,
	})
	const token = result.stdout?.trim()
	if (result.status !== 0 || !token || /\s/u.test(token))
		throw new Error('No Infisical session, run: infisical login')
	return token
}

export interface ApiResponse {
	status: number
	json: Record<string, unknown>
}

export async function call(
	token: string,
	method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
	url: string,
	body?: unknown,
): Promise<ApiResponse> {
	const response = await fetch(url, {
		method,
		headers: {
			authorization: `Bearer ${token}`,
			'content-type': 'application/json',
		},
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	})
	const json: unknown = await response.json().catch(() => ({}))
	return {
		status: response.status,
		json: typeof json === 'object' && json !== null ? { ...json } : {},
	}
}

export function query(where: SecretLocation, path: string): string {
	return new URLSearchParams({ ...where, secretPath: path }).toString()
}

/** Key names at one location; the only secret field this module ever reads back. */
export async function names(
	token: string,
	where: SecretLocation,
	path: string,
): Promise<string[]> {
	const { status, json } = await call(
		token,
		'GET',
		`${API}?${query(where, path)}`,
	)
	if (status !== 200)
		throw new Error(`Cannot list ${where.environment}: HTTP ${status}`)
	const secrets = json.secrets
	if (!Array.isArray(secrets)) throw new Error('Unexpected listing format')
	return secrets.flatMap((secret: unknown) => {
		const key =
			typeof secret === 'object' && secret !== null
				? Reflect.get(secret, 'secretKey')
				: undefined
		return typeof key === 'string' ? [key] : []
	})
}
