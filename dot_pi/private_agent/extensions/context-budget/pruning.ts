/** Recoverable, request-time pruning of old bulky tool results. */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import type {
	ContextEvent,
	ExtensionAPI,
	ToolResultEvent,
} from '@earendil-works/pi-coding-agent'

type ContextMessage = ContextEvent['messages'][number]

const ARTIFACT_DIR = 'context-artifacts'
const ARCHIVE_MIN_CHARS = 8_000
const PROTECTED_RECENT_CHARS = 160_000
const MIN_RECLAIM_CHARS = 80_000
const CHARS_PER_TOKEN = 4
const MAX_FILE_STEM = 120
const SESSION_PREFIX_LENGTH = 16
const ARTIFACT_RETENTION_DAYS = 14
const MILLISECONDS_PER_DAY = 86_400_000
const PROTECTED_TOOLS = new Set(['edit', 'write', 'goal'])

export type PruningStats = {
	replacedResults: number
	prunedChars: number
	estimatedTokens: number
}

const EMPTY_STATS: PruningStats = {
	replacedResults: 0,
	prunedChars: 0,
	estimatedTokens: 0,
}

export class ToolOutputPruner {
	private stats: PruningStats = EMPTY_STATS

	constructor(private readonly agentDir: string) {}

	register(pi: ExtensionAPI): void {
		pi.on('session_start', (_event, ctx) => {
			this.pruneArtifacts(ctx.sessionManager.getSessionId())
		})
		pi.on('tool_result', (event, ctx) =>
			this.archive(event, ctx.sessionManager.getSessionId()),
		)
		pi.on('context', (event, ctx) => {
			const transformed = this.prune(
				event.messages,
				ctx.sessionManager.getSessionId(),
			)
			if (transformed === event.messages) return
			return { messages: transformed }
		})
	}

	currentStats(): PruningStats {
		return this.stats
	}

	private pruneArtifacts(sessionId: string): void {
		const root = join(this.agentDir, ARTIFACT_DIR)
		const cutoff =
			Date.now() - ARTIFACT_RETENTION_DAYS * MILLISECONDS_PER_DAY
		const expired = expiredArtifactDirectories(
			root,
			sessionPrefix(sessionId),
			cutoff,
		)
		for (const path of expired) {
			try {
				rmSync(path, { recursive: true, force: true })
			} catch {
				// Retention is best-effort; active artifacts stay available.
			}
		}
	}

	private archive(event: ToolResultEvent, sessionId: string): void {
		if (event.isError || PROTECTED_TOOLS.has(event.toolName)) return
		const text = textContent(event.content)
		if (!text || text.length < ARCHIVE_MIN_CHARS) return
		const path = this.artifactPath(sessionId, event.toolCallId)
		if (existsSync(path)) return
		try {
			mkdirSync(
				join(this.agentDir, ARTIFACT_DIR, sessionPrefix(sessionId)),
				{
					recursive: true,
				},
			)
			writeFileSync(
				path,
				`tool: ${event.toolName}\ntoolCallId: ${event.toolCallId}\n\n${text}`,
				{ mode: 0o600 },
			)
		} catch {
			// The original result remains in context and the transcript.
		}
	}

	private prune(
		messages: ContextMessage[],
		sessionId: string,
	): ContextMessage[] {
		let recentChars = 0
		let reclaimableChars = 0
		const replacements = new Map<number, ContextMessage>()
		for (let index = messages.length - 1; index >= 0; index -= 1) {
			const message = messages[index]
			if (!message) continue
			const chars = messageChars(message)
			if (recentChars < PROTECTED_RECENT_CHARS) {
				recentChars += chars
				continue
			}
			const replacement = this.replacement(message, sessionId)
			if (!replacement) continue
			replacements.set(index, replacement)
			reclaimableChars += chars - messageChars(replacement)
		}
		if (reclaimableChars < MIN_RECLAIM_CHARS) {
			this.stats = EMPTY_STATS
			return messages
		}
		this.stats = {
			replacedResults: replacements.size,
			prunedChars: reclaimableChars,
			estimatedTokens: Math.floor(reclaimableChars / CHARS_PER_TOKEN),
		}
		return messages.map(
			(message, index) => replacements.get(index) ?? message,
		)
	}

	private replacement(
		message: ContextMessage,
		sessionId: string,
	): ContextMessage | undefined {
		if (!isToolResult(message)) return undefined
		if (message.isError || PROTECTED_TOOLS.has(message.toolName))
			return undefined
		if (message.content.some(part => part.type !== 'text')) return undefined
		const text = textContent(message.content)
		if (text.length < ARCHIVE_MIN_CHARS) return undefined
		const path = this.artifactPath(sessionId, message.toolCallId)
		if (!existsSync(path)) return undefined
		return {
			...message,
			content: [
				{
					type: 'text',
					text: `[Older ${message.toolName} output pruned from the active prompt. Full output: ${path}]`,
				},
			],
		}
	}

	private artifactPath(sessionId: string, toolCallId: string): string {
		const stem = toolCallId
			.replaceAll(/[^a-zA-Z0-9._-]/g, '_')
			.slice(0, MAX_FILE_STEM)
		return join(
			this.agentDir,
			ARTIFACT_DIR,
			sessionPrefix(sessionId),
			`${stem}.txt`,
		)
	}
}

function expiredArtifactDirectories(
	root: string,
	keep: string,
	cutoff: number,
): string[] {
	try {
		return readdirSync(root, { withFileTypes: true })
			.filter(entry => entry.isDirectory() && entry.name !== keep)
			.map(entry => join(root, entry.name))
			.filter(path => modifiedTime(path) < cutoff)
	} catch {
		return []
	}
}

function modifiedTime(path: string): number {
	try {
		return statSync(path).mtimeMs
	} catch {
		return Number.POSITIVE_INFINITY
	}
}

function sessionPrefix(sessionId: string): string {
	return sessionId.replaceAll('-', '').slice(0, SESSION_PREFIX_LENGTH)
}

function isToolResult(
	message: ContextMessage,
): message is Extract<ContextMessage, { role: 'toolResult' }> {
	return message.role === 'toolResult'
}

function textContent(content: { type: string; text?: string }[]): string {
	return content
		.filter(part => part.type === 'text' && typeof part.text === 'string')
		.map(part => part.text ?? '')
		.join('\n')
}

function messageChars(message: ContextMessage): number {
	try {
		return JSON.stringify(message).length
	} catch {
		return 0
	}
}
