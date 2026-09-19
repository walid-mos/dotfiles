/**
 * model-fallback - the settings file's own shape, for the picker's writes.
 *
 * The picker rewrites `settings.json` through a whole-file read-modify-write:
 * it reads the file as an object, keeps the indentation, the line ending and
 * the permissions the file already has, and replaces it atomically, so a
 * concurrent reader never observes a partial write and no unrelated key is
 * dropped. A file whose shape is not the one pi defines - an array, a
 * primitive - is refused here, never coerced into an object. Domain merges
 * stay in `model-picker-settings.ts`; this module owns only the file.
 */

import {
	chmodSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs'

/**
 * A JSON object read without trusting the file: an array or a primitive is
 * undefined, so a malformed file is refused rather than rewritten as an object.
 */
export function asRecord(
	candidate: unknown,
): Record<string, unknown> | undefined {
	if (
		typeof candidate !== 'object' ||
		candidate === null ||
		Array.isArray(candidate)
	)
		return undefined
	// oxlint-disable-next-line nextnode/no-type-assertion
	return candidate as Record<string, unknown>
}

export function readSettingsText(path: string): string | undefined {
	try {
		return readFileSync(path, 'utf8')
	} catch {
		return undefined
	}
}

/** The whole file as an object, or undefined when it is not one. */
export function parseSettingsObject(
	text: string,
): Record<string, unknown> | undefined {
	try {
		const parsed: unknown = JSON.parse(text)
		return asRecord(parsed)
	} catch {
		return undefined
	}
}

/** A settings file with no indentation to copy gets pi's own two spaces. */
const DEFAULT_INDENT = '  '

/** The indentation the file already uses, so a rewrite is not a reflow. */
export function indentOf(text: string): string {
	for (const line of text.split('\n')) {
		const indent = /^([\t ]+)\S/.exec(line)?.[1]
		if (indent) return indent
	}
	return DEFAULT_INDENT
}

/** The line ending the file already uses, so a rewrite is not a reflow. */
export function newlineOf(text: string): string {
	return text.includes('\r\n') ? '\r\n' : '\n'
}

/** The permissions the file already has, when there is a file to copy them from. */
function modeOf(path: string): number | undefined {
	try {
		return statSync(path).mode
	} catch {
		return undefined
	}
}

/** Write to a sibling and rename, so a reader never sees a half-written file. */
export function writeSettingsAtomically(
	path: string,
	settings: Record<string, unknown>,
	indent: string,
	newline: string,
): void {
	const temporary = `${path}.${String(process.pid)}.tmp`
	try {
		const body = JSON.stringify(settings, null, indent).replaceAll(
			'\n',
			newline,
		)
		writeFileSync(temporary, `${body}${newline}`)
		// The replace must not change what the file already was: a `0600`
		// settings.json stays `0600` instead of taking the temp file's default.
		// A stat mode always carries its file-type bits, so it is never 0 here.
		const mode = modeOf(path)
		if (mode) chmodSync(temporary, mode)
		renameSync(temporary, path)
	} catch (error) {
		rmSync(temporary, { force: true })
		throw error
	}
}
