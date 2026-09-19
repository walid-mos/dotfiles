/** Read HTTP response bodies fully but never beyond a byte budget. */

/** Declared content length, when present and parseable. */
function declaredLength(response: Response): number | undefined {
	const header = response.headers.get('content-length')
	if (!header) return undefined
	const parsedLength = Number.parseInt(header, 10)
	if (!Number.isFinite(parsedLength) || parsedLength < 0) return undefined
	return parsedLength
}

function concatenateChunks(
	chunks: readonly Uint8Array[],
	totalBytes: number,
): Uint8Array {
	const combined = new Uint8Array(totalBytes)
	let offset = 0
	for (const chunk of chunks) {
		combined.set(chunk, offset)
		offset += chunk.byteLength
	}
	return combined
}

class BoundedBufferedReader {
	readonly chunks: Uint8Array[] = []
	totalBytes = 0
	// pi and node run extension files via type stripping: no parameter
	// properties, only explicit assignments.
	private readonly maximumBytes: number

	constructor(maximumBytes: number) {
		this.maximumBytes = maximumBytes
	}

	/**
	 * Read the body until it ends, returning undefined once it would exceed
	 * `maximumBytes` (the stream is cancelled in that case).
	 */
	async readUntilBoundary(
		reader: ReadableStreamDefaultReader<Uint8Array>,
	): Promise<Uint8Array | undefined> {
		// Streaming reads are sequential by definition; cannot be batched.
		// oxlint-disable-next-line no-await-in-loop
		const chunk = await reader.read()
		if (chunk.done) return concatenateChunks(this.chunks, this.totalBytes)
		this.totalBytes += chunk.value.byteLength
		if (this.totalBytes > this.maximumBytes) {
			await reader.cancel()
			return undefined
		}
		this.chunks.push(chunk.value)
		return this.readUntilBoundary(reader)
	}
}

/**
 * Read the response body, aborting once it exceeds `maximumBytes`.
 * Returns undefined for oversized responses or read failures.
 */
export async function readBoundedBytes(
	response: Response,
	maximumBytes: number,
): Promise<Uint8Array | undefined> {
	const contentLength = declaredLength(response)
	if (contentLength && contentLength > maximumBytes) return undefined
	if (!response.body) return new Uint8Array()

	const bufferedReader = new BoundedBufferedReader(maximumBytes)
	const reader = response.body.getReader()
	try {
		return await bufferedReader.readUntilBoundary(reader)
	} catch {
		return undefined
	} finally {
		reader.releaseLock()
	}
}

/** Bounded read of the body as UTF-8 text (undefined when too large/failed). */
export async function readBoundedText(
	response: Response,
	maximumBytes: number,
): Promise<string | undefined> {
	const bytes = await readBoundedBytes(response, maximumBytes)
	if (!bytes) return undefined
	return new TextDecoder().decode(bytes)
}
