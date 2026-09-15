/** Optional, bounded before-images. Observers never modify arguments or deny a write. */
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { buffer as readBuffer } from 'node:stream/consumers'

import { reflectMember } from '../ui/pi-members.ts'

import {
	comparedChangeDocument,
	MAX_CHANGE_BYTES,
	writtenChangeDocument,
} from './change-document.ts'
import { payloadText } from './tool-payload.ts'

import type { FileHandle } from 'node:fs/promises'
import type { ChangeDocument } from '../ui/change-block.ts'

type BeforeImage = { kind: 'known'; content: string } | { kind: 'unavailable' }
type ReadBefore = (path: string, cwd: string) => Promise<BeforeImage>
interface PendingWrite {
	input: unknown
	path: string
	content: string
	before: BeforeImage
}
interface CompletedWrite {
	path: string
	content: string
	document: ChangeDocument
}
interface WriteCompletion {
	toolCallId: string
	result: unknown
	isError: boolean
}

const CACHE = Symbol.for('pi.renderers.write-diffs.v1')
const previous: unknown = Reflect.get(globalThis, CACHE)
const completed: WeakMap<
	object,
	Map<string, CompletedWrite>
> = previous instanceof WeakMap ? previous : new WeakMap()
Reflect.set(globalThis, CACHE, completed)

async function readBefore(path: string, cwd: string): Promise<BeforeImage> {
	// Native aliases/Unicode-space normalization are not guessed at this boundary.
	if (path.startsWith('@') || /\s/u.test(path.replaceAll(' ', '')))
		return { kind: 'unavailable' }
	const expanded = path.replace(/^~(?=\/|$)/u, () => homedir())
	try {
		return await readRegularFile(resolve(cwd, expanded))
	} catch (cause) {
		return reflectMember(cause, 'code') === 'ENOENT'
			? { kind: 'known', content: '' }
			: { kind: 'unavailable' }
	}
}

async function readRegularFile(path: string): Promise<BeforeImage> {
	const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK)
	try {
		const stats = await file.stat()
		if (!stats.isFile() || stats.size > MAX_CHANGE_BYTES)
			return { kind: 'unavailable' }
		return await readBoundedText(file)
	} finally {
		await file.close()
	}
}

async function readBoundedText(file: FileHandle): Promise<BeforeImage> {
	const stream = file.createReadStream({
		start: 0,
		end: MAX_CHANGE_BYTES,
		autoClose: false,
	})
	try {
		const content = await readBuffer(stream)
		if (content.length > MAX_CHANGE_BYTES || content.includes(0))
			return { kind: 'unavailable' }
		return {
			kind: 'known',
			content: new TextDecoder('utf-8', {
				fatal: true,
				ignoreBOM: true,
			}).decode(content),
		}
	} finally {
		stream.destroy()
	}
}

export class WriteSnapshots {
	private readonly pending = new Map<string, PendingWrite>()
	private readonly read: ReadBefore
	private generation = 0

	constructor(read: ReadBefore = readBefore) {
		this.read = read
	}

	async capture(
		toolCallId: string,
		input: unknown,
		cwd: string,
	): Promise<void> {
		const path = payloadText(input, 'path')
		const content = reflectMember(input, 'content')
		if (
			!path ||
			typeof content !== 'string' ||
			Buffer.byteLength(content) > MAX_CHANGE_BYTES ||
			content.includes('\0')
		)
			return
		const { generation } = this
		const before = await this.read(path, cwd)
		if (generation === this.generation)
			this.pending.set(toolCallId, { input, path, content, before })
	}

	complete(event: WriteCompletion): void {
		const pending = this.pending.get(event.toolCallId)
		this.pending.delete(event.toolCallId)
		const content = reflectMember(event.result, 'content')
		if (!pending || event.isError || !Array.isArray(content)) return
		if (
			payloadText(pending.input, 'path') !== pending.path ||
			payloadText(pending.input, 'content') !== pending.content
		)
			return
		const document =
			pending.before.kind === 'known'
				? comparedChangeDocument(
						pending.before.content,
						pending.content,
					)
				: writtenChangeDocument(pending.content)
		if (!document) return
		const calls =
			completed.get(content) ?? new Map<string, CompletedWrite>()
		calls.set(event.toolCallId, {
			path: pending.path,
			content: pending.content,
			document,
		})
		completed.set(content, calls)
	}

	clear(): void {
		this.generation++
		this.pending.clear()
	}
}

export function recalledWriteDocument(
	toolCallId: string,
	toolResult: unknown,
	args: unknown,
): ChangeDocument | undefined {
	const content = reflectMember(toolResult, 'content')
	if (!Array.isArray(content)) return undefined
	const saved = completed.get(content)?.get(toolCallId)
	if (
		saved?.path !== payloadText(args, 'path') ||
		saved.content !== payloadText(args, 'content')
	)
		return undefined
	return saved.document
}
