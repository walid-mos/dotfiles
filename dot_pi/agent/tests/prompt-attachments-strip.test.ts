import assert from 'node:assert/strict'
import test, { after } from 'node:test'

import { getCapabilities, setCapabilities } from '@earendil-works/pi-tui'

import { renderAttachmentStrip } from '../extensions/prompt-attachments/attachment-strip.ts'
import { toImageAlias } from '../extensions/prompt-attachments/image-paths.ts'

import type { TerminalCapabilities } from '@earendil-works/pi-tui'
import type { PromptCapture } from '../extensions/prompt-attachments/image-paths.ts'

const ORIGINAL_CAPABILITIES = { ...getCapabilities() }

after(() => {
	setCapabilities(ORIGINAL_CAPABILITIES)
})

function forceCapabilities(images: TerminalCapabilities['images']): void {
	setCapabilities({ ...ORIGINAL_CAPABILITIES, images })
}

function capture(number: number): PromptCapture {
	return {
		type: 'image',
		data: 'aGk=',
		mimeType: 'image/png',
		alias: toImageAlias(number),
		filePath: `/tmp/pic-${number}.png`,
		imageId: number,
	}
}

type StripTheme = Parameters<typeof renderAttachmentStrip>[3]

/** Identity theme: colors render as `role/content` to keep assertions readable. */
// Pi Theme is duck-typed through the fg/bold surface the strip renderer uses.
// oxlint-disable-next-line nextnode/no-type-assertion typescript/no-unsafe-type-assertion
const THEME = {
	// Identity render; not Tailwind classes despite the token-like strings.
	// oxlint-disable-next-line nextnode/no-detached-tailwind
	fg: (role: string, content: string) => `${role}/${content}`,
	// oxlint-disable-next-line nextnode/no-detached-tailwind
	bold: (content: string) => `b/${content}`,
} as StripTheme

void test('renders the alias list when an image protocol is unavailable', () => {
	forceCapabilities(null)

	assert.deepEqual(
		renderAttachmentStrip([capture(1), capture(2)], 0, 120, THEME),
		// The aliased text only resembles Tailwind classes; it is an expectation.
		// oxlint-disable-next-line nextnode/no-detached-tailwind
		['dim/images [img:1] [img:2]'],
	)
})

void test('renders the alias list when the viewport is narrower than a tile', () => {
	forceCapabilities('kitty')

	assert.deepEqual(
		renderAttachmentStrip([capture(1)], 0, 10, THEME),
		['dim/images [im'],
		'the compact alias list clips to the available columns',
	)
})

void test('renders a framed tile row when protocol and width allow', () => {
	forceCapabilities('kitty')

	const lines = renderAttachmentStrip([capture(1)], 0, 40, THEME)

	assert.ok(lines.length >= 4, 'edges, preview rows and a label line')
	assert.ok((lines[0] ?? '').includes('╭──────────╮'))
	assert.ok(lines[lines.length - 1]?.includes('[img:1]'))
	assert.ok(
		lines.every(line => !line.includes('images')),
		'no compact fallback line remains',
	)
})

void test('renders nothing without captures', () => {
	forceCapabilities('kitty')

	assert.deepEqual(renderAttachmentStrip([], 0, 120, THEME), [])
	assert.deepEqual(renderAttachmentStrip([], 0, 20, THEME), [])
})
