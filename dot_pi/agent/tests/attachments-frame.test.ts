/** Real Pi user/custom-entry components: thumbnail placement, replay and ownership. */
import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { stripVTControlCharacters } from 'node:util'

import { UserMessageComponent } from '@earendil-works/pi-coding-agent'
import {
	Container,
	getCapabilities,
	setCapabilities,
	Text,
} from '@earendil-works/pi-tui'

import {
	renderTranscriptAttachments,
	TRANSCRIPT_ENTRY_TYPE,
} from '../extensions/attachments/transcript-entry.ts'
import { mountPromptAttachments } from '../extensions/raw-transcript/attachment-surface.ts'
import { installRawTranscriptPatches } from '../extensions/raw-transcript/index.ts'
import { terminalLineWidth } from '../extensions/ui/terminal-text.ts'
import { CustomEntryComponent } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/custom-entry.js'
import { initTheme } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js'

import { png } from './png-fixture.ts'

import type { CustomEntry } from '@earendil-works/pi-coding-agent'
import type { TranscriptAttachments } from '../extensions/attachments/transcript-entry.ts'

initTheme('dark')
after(await installRawTranscriptPatches())
const ORIGINAL_CAPABILITIES = { ...getCapabilities() }
after(() => setCapabilities(ORIGINAL_CAPABILITIES))
const PROMPT_TEXT = 'Inspect [img:1] before making changes.'
const PREVIEW = png(40, 24, () => [40, 90, 180, 255])

function snapshot(imageId = 71): CustomEntry<TranscriptAttachments> {
	return {
		type: 'custom',
		customType: TRANSCRIPT_ENTRY_TYPE,
		id: `attachments-${String(imageId)}`,
		parentId: null,
		timestamp: '2026-01-01T00:00:00.000Z',
		data: {
			captures: [
				{
					alias: '[img:1]',
					imageId,
					mimeType: 'image/png',
					filePath: '/missing-on-purpose/image.png',
					data: PREVIEW,
				},
			],
		},
	}
}

function transcript(
	entry = snapshot(),
	source = PROMPT_TEXT,
): {
	chat: Container
	prompt: UserMessageComponent
	entry: CustomEntry<TranscriptAttachments>
} {
	const chat = new Container()
	const prompt = new UserMessageComponent(source)
	chat.addChild(prompt)
	chat.addChild(
		new CustomEntryComponent(entry, (_entry, options, theme) =>
			renderTranscriptAttachments(entry, options, theme),
		),
	)
	return { chat, prompt, entry }
}

function visible(chat: Container, width = 80): string[] {
	return chat.render(width).map(stripVTControlCharacters)
}

void test('attachment aliases appear once, inside the frame before the prompt text', () => {
	setCapabilities({ ...ORIGINAL_CAPABILITIES, images: null })
	const { chat, entry } = transcript()
	const original = structuredClone(entry)
	mountPromptAttachments(chat, entry)
	const lines = visible(chat)
	const alias = lines.findIndex(line => line.includes('images [img:1]'))
	const text = lines.findIndex(line => line.includes(PROMPT_TEXT))
	const closing = lines.findIndex(line => line.startsWith('╰'))
	assert.equal(alias, 3, 'one interior blank row precedes attachments')
	assert.equal(lines[alias + 1]?.trim(), `│${' '.repeat(78)}│`)
	assert.ok(text > alias)
	assert.ok(closing > text)
	assert.equal(
		lines.filter(line => line.includes('images [img:1]')).length,
		1,
	)
	assert.deepEqual(
		entry,
		original,
		'display relocation never mutates the saved snapshot',
	)
})

for (const protocol of ['kitty', 'iterm2'] as const) {
	void test(`${protocol} thumbnails retain their payload inside the frame above the text`, () => {
		setCapabilities({ ...ORIGINAL_CAPABILITIES, images: protocol })
		const { chat, entry } = transcript()
		mountPromptAttachments(chat, entry)
		const lines = chat.render(80)
		const image = lines.findIndex(line => line.includes(PREVIEW))
		const text = lines.findIndex(line => line.includes(PROMPT_TEXT))
		assert.ok(image > 1 && image < text)
		assert.match(stripVTControlCharacters(lines[image] ?? ''), /^│ .*│$/u)
		assert.equal(lines.filter(line => line.includes(PREVIEW)).length, 1)
		assert.ok(lines.every(line => terminalLineWidth(line) <= 80))
	})
}

void test('width changes and native user rebuilds retain the attached entry without extra strips', () => {
	setCapabilities({ ...ORIGINAL_CAPABILITIES, images: null })
	const { chat, prompt, entry } = transcript()
	mountPromptAttachments(chat, entry)
	const before = visible(chat)
	prompt.setOutputPad(2)
	chat.invalidate()
	mountPromptAttachments(chat, entry)
	assert.deepEqual(visible(chat), before)
	assert.ok(chat.render(10).every(line => terminalLineWidth(line) <= 10))
	assert.deepEqual(visible(chat), before)
})

void test('restored snapshots render without the original file or a live capture store', () => {
	setCapabilities({ ...ORIGINAL_CAPABILITIES, images: 'kitty' })
	const saved = structuredClone(snapshot())
	const { chat } = transcript(saved)
	mountPromptAttachments(chat, saved)
	assert.ok(chat.render(80).some(line => line.includes(PREVIEW)))
	assert.equal(
		visible(chat).filter(line => line.startsWith('╭─ ❯ Prompt')).length,
		1,
	)
})

void test('identical prompts with reused aliases keep their own thumbnails', () => {
	setCapabilities({ ...ORIGINAL_CAPABILITIES, images: 'kitty' })
	const first = transcript(snapshot(71))
	const second = transcript(snapshot(72))
	for (const child of second.chat.children) first.chat.addChild(child)
	mountPromptAttachments(first.chat, first.entry)
	mountPromptAttachments(first.chat, second.entry)
	assert.match(first.prompt.render(80).join('\n'), /i=71[,;]/u)
	assert.doesNotMatch(first.prompt.render(80).join('\n'), /i=72[,;]/u)
	assert.match(second.prompt.render(80).join('\n'), /i=72[,;]/u)
	assert.doesNotMatch(second.prompt.render(80).join('\n'), /i=71[,;]/u)
})

void test('an attachment that does not match the newest prompt remains visible outside it', () => {
	setCapabilities({ ...ORIGINAL_CAPABILITIES, images: null })
	const { chat, entry } = transcript(snapshot(), 'A different request.')
	const before = visible(chat)
	mountPromptAttachments(chat, entry)
	assert.deepEqual(visible(chat), before)
	assert.ok(before.at(-1)?.includes('images [img:1]'))
})

void test('unrelated custom entries keep their native transcript position', () => {
	const { chat } = transcript()
	const unrelated = {
		...snapshot(),
		customType: 'unrelated-card',
		id: 'other-entry',
	}
	chat.addChild(
		new CustomEntryComponent(
			unrelated,
			() => new Text('Other entry', 0, 0),
		),
	)
	const before = visible(chat)
	mountPromptAttachments(chat, unrelated)
	assert.deepEqual(visible(chat), before)
})
