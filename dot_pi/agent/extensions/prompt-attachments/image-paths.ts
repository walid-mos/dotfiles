/** File-system side of prompt image captures: alias format + format sniffing. */

import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'

import type { ImageContent } from '@earendil-works/pi-ai'

/** Alias format inserted into prompt text in place of a file path. */
export const IMAGE_ALIAS_PATTERN = /\[img:\d+\]/gu

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

/** Reads an image file into a capture; undefined when it is no image file. */
export function readImageCapture(
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

/** '~/' prefix length, stripped before resolving against the home directory. */
const HOMEDIR_PREFIX_LENGTH = 2

function resolvePath(pathText: string, cwd: string): string {
	if (pathText.startsWith('~/')) {
		return resolve(homedir(), pathText.slice(HOMEDIR_PREFIX_LENGTH))
	}
	return isAbsolute(pathText) ? resolve(pathText) : resolve(cwd, pathText)
}

/** A path when it plausibly starts one: absolute, relative, or home ref. */
export function looksLikePath(pathText: string): boolean {
	return (
		pathText.startsWith('/') ||
		pathText.startsWith('./') ||
		pathText.startsWith('../') ||
		pathText.startsWith('~/')
	)
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
