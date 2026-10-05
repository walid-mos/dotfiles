import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { truncateHead } from '@earendil-works/pi-coding-agent'

const MAX_TEXT_BYTES = 16000
const MAX_LOG_ENTRY_BYTES = 2000
const DEFAULT_LOG_ENTRIES = 100

export type LogEntry = {
	kind: 'console' | 'pageerror' | 'requestfailed' | 'http'
	level: 'error' | 'warning' | 'info'
	text: string
}

export function normalizeUrl(raw: string, cwd: string): string {
	const address = raw.trim().replace(/^@(?=[./])/, '')
	if (!address)
		throw new Error('Empty URL; provide an HTTP(S) URL or HTML path.')
	if (isAbsolute(address) || /^\.{1,2}\//.test(address)) {
		return pathToFileURL(resolve(cwd, address)).href
	}
	const isHostPort = /^(?:[a-z0-9.-]+|\[[a-f0-9:]+\]):\d+([/?#]|$)/i.test(
		address,
	)
	const hasScheme = !isHostPort && /^[a-z][a-z0-9+.-]*:/i.test(address)
	const url = new URL(hasScheme ? address : `http://${address}`)
	if (!['http:', 'https:', 'file:'].includes(url.protocol))
		throw new Error(`Unsupported scheme: ${url.protocol}`)
	if (url.username || url.password)
		throw new Error(
			'URL credentials are not accepted; use a dedicated test login flow.',
		)
	return url.href
}

export function boundedText(text: string, maxBytes = MAX_TEXT_BYTES): string {
	const truncation = truncateHead(text, { maxBytes, maxLines: 200 })
	return truncation.truncated
		? `${truncation.content}\n[truncated; request a narrower result]`
		: truncation.content
}

export class BrowserLog {
	private entries: LogEntry[] = []
	private errors = 0
	private warnings = 0
	private dropped = 0
	private capacity: number

	constructor(capacity: number) {
		this.capacity = capacity
	}

	record(entry: LogEntry): void {
		if (entry.level === 'error') this.errors += 1
		if (entry.level === 'warning') this.warnings += 1
		this.entries.push({
			...entry,
			text: boundedText(entry.text, MAX_LOG_ENTRY_BYTES),
		})
		if (this.entries.length <= this.capacity) return
		this.entries.shift()
		this.dropped += 1
	}

	clear(): void {
		this.entries = []
		this.errors = 0
		this.warnings = 0
		this.dropped = 0
	}

	summary(): string {
		const eviction = this.dropped
			? ` ${this.dropped} older entries evicted; counts retained.`
			: ''
		return `Console since open: ${this.errors} error(s), ${this.warnings} warning(s).${eviction}`
	}

	format(level = 'all', max = DEFAULT_LOG_ENTRIES): string {
		const matching = this.entries.filter(
			entry => level === 'all' || entry.level === level,
		)
		const shown = matching.slice(-max)
		const lines = shown.map(
			entry => `[${entry.level}] (${entry.kind}) ${entry.text}`,
		)
		return boundedText(
			[
				this.summary(),
				`${matching.length - shown.length} matching entries omitted.`,
				...lines,
			].join('\n'),
		)
	}
}
