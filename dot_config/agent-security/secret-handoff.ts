/**
 * Contract between ask_user_secret (issuer) and the browser tools (claimant):
 * a secret typed by the human is parked in-process under a one-time handle,
 * bound to one web origin, and expires untouched. Shared across the harness
 * through globalThis because jiti gives every extension its own module registry.
 */
export const SECRET_HANDOFF_KEY = Symbol.for('pi.ask-user-secret.handoff.v1')
export const SECRET_HANDLE_PATTERN = '^sec:[A-Za-z0-9_-]{22}$'
export const SECRET_HANDLE_TTL_MS = 180_000

export type ClaimFailure = 'unknown' | 'expired' | 'origin'

export type ClaimResult =
	| { ok: true; value: string }
	| { ok: false; reason: ClaimFailure }

export interface SecretHandoff {
	issue(value: string, origin: string): { handle: string; expiresAt: number }
	claim(handle: string, origin: string): ClaimResult
}
