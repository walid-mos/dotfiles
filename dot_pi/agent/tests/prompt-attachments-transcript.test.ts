import assert from 'node:assert/strict'
import test, { after } from 'node:test'

import { getCapabilities, setCapabilities } from '@earendil-works/pi-tui'

import {
	capturesForMessage,
	renderTranscriptAttachments,
	SubmittedCaptures,
	TRANSCRIPT_ENTRY_TYPE,
	transcriptCapture,
} from '../extensions/prompt-attachments/transcript-entry.ts'

import type { UserMessage } from '@earendil-works/pi-ai'
import type {
	CustomEntry,
	EntryRenderOptions,
	SessionEntry,
	Theme,
} from '@earendil-works/pi-coding-agent'
import type { TerminalCapabilities } from '@earendil-works/pi-tui'
import type { PromptCapture } from '../extensions/prompt-attachments/image-paths.ts'
import type {
	TranscriptAttachments,
	TranscriptCapture,
} from '../extensions/prompt-attachments/transcript-entry.ts'

const ORIGINAL_CAPABILITIES = { ...getCapabilities() }

after(() => {
	setCapabilities(ORIGINAL_CAPABILITIES)
})

function forceCapabilities(images: TerminalCapabilities['images']): void {
	setCapabilities({ ...ORIGINAL_CAPABILITIES, images })
}

/** Identity theme: assertions read the text, not the styling. */
// oxlint-disable-next-line nextnode/no-type-assertion typescript/no-unsafe-type-assertion
const THEME = {
	fg: (_color: string, content: string) => content,
	bold: (content: string) => content,
} as Theme

const OPTIONS: EntryRenderOptions = { expanded: false }

function capture(number: number): PromptCapture {
	return {
		type: 'image',
		data: 'aGk=',
		mimeType: 'image/png',
		alias: `[img:${number}]`,
		filePath: `/tmp/shot-${number}.png`,
		imageId: number,
	}
}

/** Entry fixture: `data` is omitted entirely when a test wants an empty one. */
function entry(
	attachments?: TranscriptAttachments,
): CustomEntry<TranscriptAttachments> {
	const base = {
		type: 'custom' as const,
		customType: TRANSCRIPT_ENTRY_TYPE,
		id: 'entry-1',
		parentId: null,
		timestamp: '2026-01-01T00:00:00.000Z',
	}
	return attachments ? { ...base, data: attachments } : base
}

void test('the snapshot prefers the warm preview over the capture payload', () => {
	const warm = transcriptCapture(capture(1), 'cHJldmlldw==')
	const cold = transcriptCapture(capture(1), undefined)

	assert.equal(warm.data, 'cHJldmlldw==')
	assert.equal(cold.data, 'aGk=')
	assert.deepEqual(
		{ ...cold, data: undefined },
		{
			alias: '[img:1]',
			mimeType: 'image/png',
			filePath: '/tmp/shot-1.png',
			imageId: 1,
			data: undefined,
		},
	)
})

void test('an entry without captures renders nothing', () => {
	assert.equal(
		renderTranscriptAttachments(entry({ captures: [] }), OPTIONS, THEME),
		undefined,
	)
	assert.equal(
		renderTranscriptAttachments(entry(), OPTIONS, THEME),
		undefined,
	)
})

void test('the entry replays the framed strip under the message', () => {
	forceCapabilities('kitty')
	const component = renderTranscriptAttachments(
		entry({ captures: [snapshot(1), snapshot(2)] }),
		OPTIONS,
		THEME,
	)

	assert.ok(component, 'a strip component is returned')
	const lines = component.render(60)

	assert.ok(lines.length >= 4, `expected frames, saw ${lines.join('\n')}`)
	assert.ok(
		(lines[0] ?? '').includes(
			'\u256d\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256e',
		),
	)
	assert.ok((lines.at(-1) ?? '').includes('[img:1]'))
	assert.ok((lines.at(-1) ?? '').includes('[img:2]'))
})

void test('terminals without image support fall back to the alias list', () => {
	forceCapabilities(null)
	const component = renderTranscriptAttachments(
		entry({ captures: [snapshot(1), snapshot(2)] }),
		OPTIONS,
		THEME,
	)

	// oxlint-disable-next-line nextnode/no-detached-tailwind
	assert.deepEqual(component?.render(60), ['images [img:1] [img:2]'])
})

function snapshot(number: number): TranscriptCapture {
	return transcriptCapture(capture(number), undefined)
}

/** User message fixture; the transcript guard reads its text and images. */
function userMessage(content: UserMessage['content']): UserMessage {
	return { role: 'user', content, timestamp: 0 }
}

void test('a snapshot only replays under the message showing its aliases', () => {
	const attachments = { captures: [snapshot(1), snapshot(2)] }
	const matching = userMessage([
		{ type: 'text', text: 'see [img:2] twice' },
		{ type: 'image', data: 'aGk=', mimeType: 'image/png' },
	])

	assert.deepEqual(
		capturesForMessage(matching, attachments).captures.map(
			attached => attached.alias,
		),
		['[img:2]'],
	)
	assert.deepEqual(
		capturesForMessage(userMessage('no captures here'), attachments)
			.captures,
		[],
	)
	assert.deepEqual(
		capturesForMessage(matching, { captures: [] }).captures,
		[],
	)
})

void test('a submitted snapshot retires with the turn that replays it', () => {
	const submitted = new SubmittedCaptures()
	submitted.snapshot({ captures: [snapshot(1), snapshot(2)] })

	const branch = [messageEntry('see [img:2] here')]
	assert.deepEqual(
		submitted.take(branch)?.captures.map(attached => attached.alias),
		['[img:2]'],
	)
	assert.equal(submitted.take(branch), undefined, 'the slot is now empty')
})

void test('a snapshot survives a branch that does not hold its message yet', () => {
	const submitted = new SubmittedCaptures()
	submitted.snapshot({ captures: [snapshot(1)] })

	// pi persists a prompt only at its own message_end, and some events - the
	// prompt's own turn_start included - are emitted before it.
	assert.equal(
		submitted.take([messageEntry('a prompt without aliases')]),
		undefined,
		'the previous message cannot claim it',
	)
	assert.equal(submitted.take([]), undefined, 'no user message to hold it')
	assert.deepEqual(
		submitted
			.take([
				messageEntry('an earlier prompt'),
				messageEntry('see [img:1]'),
			])
			?.captures.map(attached => attached.alias),
		['[img:1]'],
		'once the carrying message is on the branch, the snapshot is claimed',
	)
	assert.equal(submitted.take([messageEntry('see [img:1]')]), undefined)
})

void test('an unclaimed snapshot is dropped by the end of the run', () => {
	const submitted = new SubmittedCaptures()
	submitted.snapshot({ captures: [snapshot(1)] })
	submitted.clear()

	assert.equal(submitted.take([messageEntry('see [img:1]')]), undefined)
})

/** Session entry fixture: one user message on the branch. */
function messageEntry(text: string): SessionEntry {
	return {
		type: 'message',
		id: 'message-1',
		parentId: null,
		timestamp: '2026-01-01T00:00:00.000Z',
		message: userMessage(text),
	}
}
