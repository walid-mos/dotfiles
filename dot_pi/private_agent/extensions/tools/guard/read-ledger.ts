import { createHash } from 'node:crypto'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'

/** Durable metadata only: no file contents or secrets enter this entry. */
export const READ_LEDGER_ENTRY = 'pi-read-ledger-v2'
const MAX_READS = 128
const READ_ENTRY_FIELDS = 4
type CompletedRead = { signature: string; callId: string; contentHash: string }

function contentHash(content: unknown): string {
	return createHash('sha256')
		.update(JSON.stringify(content) ?? '')
		.digest('hex')
}

interface PendingRead {
	key: string
	signature: string
	generation: number
}

/** Identical successful reads are useful only while their source is unchanged. */
export class ReadLedger {
	private readonly completed = new Map<string, CompletedRead>()
	private readonly visible = new Map<string, string>()
	private readonly pending = new Map<string, PendingRead>()
	private generation = 0

	clear(): void {
		this.generation += 1
		this.completed.clear()
		this.pending.clear()
		this.visible.clear()
	}

	snapshot(): [string, string, string, string][] {
		return [...this.completed].map(([key, read]) => [
			key,
			read.signature,
			read.callId,
			read.contentHash,
		])
	}

	/** Refuse only while the exact successful source result is still model-visible. */
	observe(
		messages: readonly {
			role: string
			toolCallId?: string
			toolName?: string
			content?: unknown
			isError?: boolean
		}[],
	): void {
		this.visible.clear()
		for (const message of messages) {
			if (
				message.role !== 'toolResult' ||
				message.toolName !== 'read' ||
				message.isError ||
				!message.toolCallId
			)
				continue
			this.visible.set(message.toolCallId, contentHash(message.content))
		}
	}

	restore(snapshot: unknown): void {
		this.clear()
		if (!Array.isArray(snapshot)) return
		for (const entry of snapshot.slice(-MAX_READS)) {
			if (
				!Array.isArray(entry) ||
				entry.length !== READ_ENTRY_FIELDS ||
				!entry.every(field => typeof field === 'string')
			)
				continue
			const [key, signature, callId, hash] = entry
			if (key && signature && callId && hash)
				this.completed.set(key, {
					signature,
					callId,
					contentHash: hash,
				})
		}
	}

	begin(
		callId: string,
		cwd: string,
		input: { path: string; offset?: number | null; limit?: number | null },
	): boolean {
		const path = resolve(cwd, input.path)
		const signature = this.signature(path)
		if (!signature) return false
		const key = JSON.stringify([
			path,
			input.offset ?? 1,
			input.limit ?? null,
		])
		const previous = this.completed.get(key)
		if (
			previous?.signature === signature &&
			this.visible.get(previous.callId) === previous.contentHash
		)
			return true
		this.pending.set(callId, {
			key,
			signature,
			generation: this.generation,
		})
		return false
	}

	complete(callId: string, isError: boolean, content: unknown): void {
		const read = this.pending.get(callId)
		this.pending.delete(callId)
		if (!read || isError || read.generation !== this.generation) return
		this.completed.delete(read.key)
		this.completed.set(read.key, {
			signature: read.signature,
			callId,
			contentHash: contentHash(content),
		})
		if (this.completed.size > MAX_READS) {
			const oldest = this.completed.keys().next().value
			if (oldest) this.completed.delete(oldest)
		}
	}

	private signature(path: string): string | undefined {
		try {
			const file = statSync(path)
			if (!file.isFile()) return undefined
			return `${file.dev}:${file.ino}:${file.size}:${file.mtimeMs}:${file.ctimeMs}`
		} catch {
			// An unreadable or missing file must reach the original read tool.
			return undefined
		}
	}
}
