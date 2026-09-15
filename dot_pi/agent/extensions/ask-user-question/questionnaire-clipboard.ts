/**
 * Ctrl+V clipboard capture for the questionnaire free-text editor, mirroring
 * pi's own prompt paste: a clipboard image is first written to a temp PNG and
 * inserted as its path, which the alias rewrite captures; non-image
 * clipboards paste their text. Only macOS has a usable implementation today
 * (osascript + `pbpaste`); elsewhere this stays a silent no-op, matching
 * `readClipboardImage`'s degradation without duplicating its platform stack.
 */

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

const OSASCRIPT_TIMEOUT_MS = 3000
const PBPASTE_TIMEOUT_MS = 2000

/**
 * Read the clipboard and produce insertable editor text: the temp-file path
 * when it holds an image, the text otherwise; undefined when empty.
 */
export async function clipboardInsertion(): Promise<string | undefined> {
	const imagePath = await readClipboardImagePath()
	if (imagePath) return imagePath
	return readClipboardText()
}

/** Write the clipboard image to a temp PNG; undefined when none is present. */
async function readClipboardImagePath(): Promise<string | undefined> {
	if (process.platform !== 'darwin') return undefined
	const filePath = join(tmpdir(), `pi-clipboard-${randomUUID()}.png`)
	// oxlint-disable-next-line nextnode/no-confusable-chars - AppleScript names its picture class with guillemets
	const PNG_CLASS = '«class PNGf»'
	const script = [
		`set destination to open for access (POSIX file "${filePath}") with write permission`,
		'try',
		`write (the clipboard as ${PNG_CLASS}) to destination`,
		'on error errorText number errorNumber',
		'close access destination',
		'error errorText number errorNumber',
		'end try',
		'close access destination',
	].join('\n')
	try {
		await exec('osascript', ['-e', script], {
			timeout: OSASCRIPT_TIMEOUT_MS,
		})
		if (!readFileSync(filePath).length) {
			removeQuietly(filePath)
			return undefined
		}
		return filePath
	} catch {
		removeQuietly(filePath)
		return undefined
	}
}

/** Paste the clipboard's plain text (`pbpaste`); undefined when empty. */
async function readClipboardText(): Promise<string | undefined> {
	if (process.platform !== 'darwin') return undefined
	try {
		const { stdout } = await exec('pbpaste', [], {
			timeout: PBPASTE_TIMEOUT_MS,
		})
		// Binary clipboard types surface null bytes through `pbpaste`; editors
		// show them as replacement glyphs, so strip them for a clean text paste.
		// oxlint-disable-next-line eslint/no-control-regex - the control byte is the payload
		const text = stdout.replace(/\u0000/g, '')
		if (text) return text
		return undefined
	} catch {
		return undefined
	}
}

function removeQuietly(filePath: string): void {
	try {
		unlinkSync(filePath)
	} catch {
		// The failure path may never have created the file.
	}
}
