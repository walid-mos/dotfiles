import { statSync } from 'node:fs'
import { resolve } from 'node:path'

interface PendingRead {
	key: string
	signature: string
	generation: number
}

/** Identical successful reads are useful only while their source is unchanged. */
export class ReadLedger {
	private readonly completed = new Map<string, string>()
	private readonly pending = new Map<string, PendingRead>()
	private generation = 0

	clear(): void {
		this.generation += 1
		this.completed.clear()
		this.pending.clear()
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
		if (this.completed.get(key) === signature) return true
		this.pending.set(callId, {
			key,
			signature,
			generation: this.generation,
		})
		return false
	}

	complete(callId: string, isError: boolean): void {
		const read = this.pending.get(callId)
		this.pending.delete(callId)
		if (!read || isError || read.generation !== this.generation) return
		this.completed.set(read.key, read.signature)
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
