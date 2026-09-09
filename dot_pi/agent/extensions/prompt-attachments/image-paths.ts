/** File-system side of prompt image captures: path heuristics + format sniffing. */

import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'

import type { ImageContent } from '@earendil-works/pi-ai'

/** Alias format inserted into prompt text in place of a file path. */
export const IMAGE_ALIAS_PATTERN = /\[img:\d+\]/gu

/** Unquoted shell word: double/single quoted strings or escaped bare words. */
export const SHELL_WORD = /"(?:\\.|[^"\\])*"|'[^']*'|(?:\\.|[^\s])+/gu

export function toImageAlias(number: number): string {
	return `[img:${number}]`
}

/** A read image kept for the prompt: the attachment payload plus its alias. */
export type PromptCapture = ImageContent & {
	readonly alias: string
	readonly filePath: string
	/** Stable Kitty image id so strip renders reuse one screen image per capture. */
	readonly imageId: number
}

/** +20 MiB per capture; images beyond this are too heavy for a prompt. */
const MAX_IMAGE_BYTES = 20_971_520
const MAX_KITTY_IMAGE_ID = 0xfffffffe
/** Hex radix for parsing the sniff table below. */
const HEX_RADIX = 16
/** Bytes in the sniff table are written as two hex characters each. */
const HEX_DIGITS_PER_BYTE = 2

/** Leading hex-encoded bytes per supported image format. */
const IMAGE_SIGNATURES = {
	png: '89504e47',
	jpeg: 'ffd8ff',
	gif: '47494638',
	webpContainer: '52494646',
	webpFormatTag: '57454250',
} as const

/** WebP puts its format tag after the 8-byte RIFF header plus 4 size bytes. */
const WEBP_TAG_OFFSET = 8

export type ImagePathIngest = {
	readonly capture: PromptCapture
	/** The token with the captured path subrange replaced by the alias. */
	readonly replacement: string
}

/**
 * Decode one command-like token and turn the first image path it contains
 * into a capture. The replacement reproduces the token with only the path
 * subrange swapped, keeping surrounding quotes and punctuation in place.
 */
export function ingestImagePathToken(
	token: string,
	cwd: string,
	aliasNumber: number,
): ImagePathIngest | undefined {
	const decoded = decodeShellWord(token)
	for (const start of pathStartIndexes(decoded)) {
		const ingest = ingestAtStartEnd(decoded, start, cwd, aliasNumber)
		if (ingest) return ingest
	}
	return undefined
}

function ingestAtStartEnd(
	decoded: string,
	start: number,
	cwd: string,
	aliasNumber: number,
): ImagePathIngest | undefined {
	for (const end of pathEndIndexes(decoded, start)) {
		const capture = readImageCapture(
			decoded.slice(start, end),
			cwd,
			aliasNumber,
		)
		if (!capture) continue
		return {
			capture,
			replacement: `${decoded.slice(0, start)}${toImageAlias(aliasNumber)}${decoded.slice(end)}`,
		}
	}
	return undefined
}

function readImageCapture(
	pathText: string,
	cwd: string,
	aliasNumber: number,
): PromptCapture | undefined {
	if (!looksLikePath(pathText)) return undefined
	const filePath = resolvePath(pathText, cwd)
	try {
		const stats = statSync(filePath)
		if (!stats.isFile() || stats.size === 0 || stats.size > MAX_IMAGE_BYTES)
			return undefined
		const bytes = readFileSync(filePath)
		const mimeType = detectImageMimeType(bytes)
		if (!mimeType) return undefined
		return {
			type: 'image',
			data: bytes.toString('base64'),
			mimeType,
			alias: toImageAlias(aliasNumber),
			filePath,
			imageId: Math.floor(Math.random() * MAX_KITTY_IMAGE_ID) + 1,
		}
	} catch {
		return undefined
	}
}

/** Offsets where a decoded token plausibly starts a path. */
function pathStartIndexes(pathText: string): number[] {
	const indexes = new Set<number>()
	for (let index = 0; index < pathText.length; index += 1) {
		if (looksLikePath(pathText.slice(index))) indexes.add(index)
	}
	return [...indexes]
}

/** Path end offsets inside a token, longest first, trimming trailing punctuation. */
function pathEndIndexes(pathText: string, start: number): number[] {
	const indexes = [pathText.length]
	let end = pathText.length
	while (end > start && /[,.;:!?\])}]/u.test(pathText[end - 1] ?? '')) {
		end -= 1
		indexes.push(end)
	}
	return indexes
}

/** Strip one level of shell quoting and backslash escaping. */
function decodeShellWord(token: string): string {
	if (token.startsWith("'") && token.endsWith("'")) return token.slice(1, -1)
	if (token.startsWith('"') && token.endsWith('"')) return token.slice(1, -1)
	return token.replace(/\\(.)/gu, '$1')
}

function looksLikePath(pathText: string): boolean {
	return (
		pathText.startsWith('/') ||
		pathText.startsWith('./') ||
		pathText.startsWith('../') ||
		pathText.startsWith('~/')
	)
}

/** '~/' prefix length, stripped before resolving against the home directory. */
const HOMEDIR_PREFIX_LENGTH = 2

function resolvePath(pathText: string, cwd: string): string {
	if (pathText.startsWith('~/')) {
		return resolve(homedir(), pathText.slice(HOMEDIR_PREFIX_LENGTH))
	}
	return isAbsolute(pathText) ? resolve(pathText) : resolve(cwd, pathText)
}

function detectImageMimeType(bytes: Uint8Array): string | undefined {
	if (hasSignature(bytes, IMAGE_SIGNATURES.png)) return 'image/png'
	if (hasSignature(bytes, IMAGE_SIGNATURES.jpeg)) return 'image/jpeg'
	if (hasSignature(bytes, IMAGE_SIGNATURES.gif)) return 'image/gif'
	if (
		hasSignature(bytes, IMAGE_SIGNATURES.webpContainer) &&
		hasSignature(
			bytes.slice(WEBP_TAG_OFFSET),
			IMAGE_SIGNATURES.webpFormatTag,
		)
	)
		return 'image/webp'
	return undefined
}

function hasSignature(bytes: Uint8Array, hexSignature: string): boolean {
	for (
		let offset = 0;
		offset < hexSignature.length;
		offset += HEX_DIGITS_PER_BYTE
	) {
		const hexPair = hexSignature.slice(offset, offset + HEX_DIGITS_PER_BYTE)
		const expected = Number.parseInt(hexPair, HEX_RADIX)
		const byteIndex = offset / HEX_DIGITS_PER_BYTE
		if (bytes[byteIndex] !== expected) return false
	}
	return true
}
