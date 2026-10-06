// Pause an unchanged failed operation for diagnosis, never the agent's work.
import { createHash } from 'node:crypto'

import type {
	ExtensionAPI,
	SessionEntry,
	ToolResultEvent,
} from '@earendil-works/pi-coding-agent'

const RECOVERY_ENTRY = 'frontend-recovery-v1'
const RECOVERY_PREFIX = 'RECOVERY_REQUIRED:'
const RECOVERY_TOOLS = new Set([
	'read',
	'edit',
	'write',
	'bash',
	'frontend_eval',
	'frontend_console',
	'frontend_batch',
	'frontend_compare',
])

function canonical(argument: unknown): unknown {
	if (Array.isArray(argument)) return argument.map(canonical)
	if (argument && typeof argument === 'object')
		return Object.fromEntries(
			Object.entries(argument)
				.toSorted(([a], [b]) => a.localeCompare(b))
				.map(([key, item]) => [key, canonical(item)]),
		)
	return argument
}

function digest(observation: unknown): string {
	return createHash('sha256')
		.update(JSON.stringify(observation))
		.digest('hex')
}

function requestIdentity(tool: string, input: unknown): string {
	return digest([tool, canonical(input)])
}

function failureFingerprint(event: ToolResultEvent): string | undefined {
	if (!event.toolName.startsWith('frontend_') || !event.isError)
		return undefined
	const text = event.content
		.filter(block => block.type === 'text')
		.map(block => block.text)
		.join('\n')
	if (text.startsWith(RECOVERY_PREFIX)) return undefined
	return digest(text.replace(/\b\d+(?:\.\d+)?\s*ms\b/g, '<duration>'))
}

function hasRecoveryStep(entry: SessionEntry): boolean {
	if (entry.type !== 'message') return false
	const { message } = entry
	return (
		message.role === 'user' ||
		(message.role === 'toolResult' &&
			!message.isError &&
			RECOVERY_TOOLS.has(message.toolName))
	)
}

function previousFailure(
	entries: readonly SessionEntry[],
	request: string,
): { fingerprint: string; isHeld: boolean } | undefined {
	for (const entry of entries.toReversed()) {
		if (hasRecoveryStep(entry)) return undefined
		if (
			entry.type !== 'custom' ||
			entry.customType !== RECOVERY_ENTRY ||
			!entry.data ||
			typeof entry.data !== 'object'
		)
			continue
		if (Reflect.get(entry.data, 'request') !== request) continue
		const fingerprint: unknown = Reflect.get(entry.data, 'fingerprint')
		if (typeof fingerprint === 'string')
			return {
				fingerprint,
				isHeld: Reflect.get(entry.data, 'isHeld') === true,
			}
	}
	return undefined
}

function recoveryGuidance(tool: string): string {
	return `${RECOVERY_PREFIX} Only this unchanged ${tool} operation needs a different approach; the task and all other tools remain active. Do not repeat it blindly or stop to ask the user to resume. Inspect the preserved page and console, check the actual API response and relevant workspace/date/locale, then correct the cause or the readiness assumption. A successful diagnostic or authorized corrective action permits another attempt; a source-file edit is not required. A successful eval alone does not prove the intended data changed: verify its response and rendered effect. If this check remains blocked, record the exact unresolved criterion and continue independent requested work. Never waive a failed check or claim completion of unfinished work.`
}

export function registerProgressRecovery(pi: ExtensionAPI): void {
	pi.on('tool_result', (event, ctx) => {
		const fingerprint = failureFingerprint(event)
		if (!fingerprint) return undefined
		const request = requestIdentity(event.toolName, event.input)
		const previous = previousFailure(
			ctx.sessionManager.getBranch(),
			request,
		)
		const isHeld = previous?.fingerprint === fingerprint
		pi.appendEntry(RECOVERY_ENTRY, { request, fingerprint, isHeld })
		if (!isHeld) return undefined
		return {
			content: [
				...event.content,
				{
					type: 'text' as const,
					text: recoveryGuidance(event.toolName),
				},
			],
			isError: event.isError,
		}
	})
	pi.on('tool_call', (event, ctx) => {
		if (!event.toolName.startsWith('frontend_')) return undefined
		const request = requestIdentity(event.toolName, event.input)
		if (!previousFailure(ctx.sessionManager.getBranch(), request)?.isHeld)
			return undefined
		return { block: true, reason: recoveryGuidance(event.toolName) }
	})
}
