/** Separate process: prove Jiti patches the same bundled classes the CLI actually renders. */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { stripVTControlCharacters } from 'node:util'

import { getPackageDir } from '@earendil-works/pi-coding-agent'
import { ProcessTerminal, TuiMainScreen } from '@earendil-works/pi-tui'

import { isPromptAttachment } from '../extensions/ui/prompt-attachment.ts'
import {
	initTheme as initLocalTheme,
	theme,
} from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js'

import { assistantMessage } from './response-fixture.ts'

const bundleRoot = join(getPackageDir(), 'dist/bundle')
const runtime = await import(pathToFileURL(join(bundleRoot, 'index.js')).href)
process.argv[1] = join(bundleRoot, 'cli.js')
const { prototype } = runtime.ToolExecutionComponent
const originalRender = prototype.render
const originalAssistantUpdate =
	runtime.AssistantMessageComponent.prototype.updateContent
const originalEntryMount =
	runtime.InteractiveMode.prototype.addCustomEntryToChat
const PROBE_COLUMNS = 100
const EXPECTED_EXTENSIONS = 3
const sandbox = mkdtempSync(join(tmpdir(), 'pi-renderers-loader-'))

class QuietTerminal extends ProcessTerminal {
	write() {
		/* The probe never writes terminal control sequences. */
	}
	hideCursor() {
		/* No terminal IO. */
	}
	showCursor() {
		/* No terminal IO. */
	}
}

try {
	const extension = fileURLToPath(
		new URL('../extensions/renderers/index.ts', import.meta.url),
	)
	const rawTranscript =
		process.env.PI_RESPONSE_LEGACY_FIXTURE ??
		fileURLToPath(
			new URL('../extensions/raw-transcript/index.ts', import.meta.url),
		)
	const attachments = fileURLToPath(
		new URL('../extensions/prompt-attachments/index.ts', import.meta.url),
	)
	const loaded = await runtime.discoverAndLoadExtensions(
		[attachments, rawTranscript, extension],
		sandbox,
		sandbox,
	)
	assert.deepEqual(loaded.errors, [])
	assert.equal(loaded.extensions.length, EXPECTED_EXTENSIONS)
	assert.ok(
		loaded.extensions.every(
			loadedExtension => loadedExtension.tools.size === 0,
		),
	)
	assert.notEqual(prototype.render, originalRender)
	runtime.initTheme('dark')
	initLocalTheme('dark')
	assert.notEqual(
		runtime.InteractiveMode.prototype.addCustomEntryToChat,
		originalEntryMount,
	)
	const attachmentExtension = loaded.extensions.find(candidate =>
		candidate.entryRenderers?.has('prompt-attachments'),
	)
	const attachmentRenderer =
		attachmentExtension?.entryRenderers.get('prompt-attachments')
	const attachmentContent = attachmentRenderer?.(
		{
			data: {
				captures: [
					{
						alias: '[img:1]',
						mimeType: 'image/png',
						filePath: '/tmp/shot.png',
						imageId: 1,
						data: 'aGk=',
					},
				],
			},
		},
		{ expanded: false },
		theme,
	)
	assert.ok(
		isPromptAttachment(attachmentContent),
		'the attachment contract crosses Jiti extension boundaries',
	)
	assert.equal(attachmentContent.matchesPrompt('Inspect [img:1]'), true)
	const prompt = new runtime.UserMessageComponent(
		'**Literal prompt**\n\nNext paragraph',
	)
	const promptLines = prompt
		.render(PROBE_COLUMNS)
		.map(stripVTControlCharacters)
	assert.match(promptLines[1], /^╭─ ❯ Prompt .*╮$/u)
	assert.ok(promptLines.some(line => line.startsWith('│ **Literal prompt**')))
	assert.ok(promptLines.some(line => /^╰─+╯$/u.test(line)))
	assert.notEqual(
		runtime.AssistantMessageComponent.prototype.updateContent,
		originalAssistantUpdate,
	)
	const answer = new runtime.AssistantMessageComponent(
		assistantMessage('**Styled answer**'),
		true,
	)
	const response = answer
		.render(PROBE_COLUMNS)
		.map(stripVTControlCharacters)
		.join('\n')
	assert.match(response, /✦ Answer/u)
	assert.match(response, /Styled answer/u)
	assert.doesNotMatch(response, /\*\*Styled answer\*\*/u)
	const ui = new TuiMainScreen(new QuietTerminal())
	for (const name of [
		'read',
		'grep',
		'find',
		'bash',
		'subagent',
		'new_tool',
	]) {
		const row = new runtime.ToolExecutionComponent(
			name,
			name,
			{
				path: 'a.ts',
				pattern: '*.ts',
				command: 'npm test',
				action: 'guide',
			},
			{},
			undefined,
			ui,
			sandbox,
		)
		row.updateResult({
			content: [{ type: 'text', text: 'one\ntwo' }],
			isError: false,
		})
		const lines = row.render(PROBE_COLUMNS)
		assert.equal(lines.length, 1)
		assert.match(stripVTControlCharacters(lines[0]), /^├─+ +✓ +/u)
	}
	const rendererExtension = loaded.extensions.find(
		candidate => candidate.path === extension,
	)
	assert.ok(rendererExtension)
	const writeArgs = { path: 'written.ts', content: 'const changed = true;\n' }
	writeFileSync(join(sandbox, writeArgs.path), 'const changed = false;\n')
	const call = {
		type: 'tool_call',
		toolName: 'write',
		toolCallId: 'jiti-write',
		input: writeArgs,
	}
	const context = { hasUI: true, cwd: sandbox }
	const beforeHooks = rendererExtension.handlers.get('tool_call') ?? []
	assert.ok(beforeHooks.length > 0)
	await Promise.all(beforeHooks.map(handler => handler(call, context)))
	const writeOutput = await runtime
		.createWriteTool(sandbox)
		.execute(call.toolCallId, writeArgs)
	const ended = {
		type: 'tool_execution_end',
		toolName: 'write',
		toolCallId: call.toolCallId,
		result: writeOutput,
		isError: false,
	}
	const afterHooks =
		rendererExtension.handlers.get('tool_execution_end') ?? []
	assert.ok(afterHooks.length > 0)
	await Promise.all(afterHooks.map(handler => handler(ended, context)))
	const written = new runtime.ToolExecutionComponent(
		'write',
		call.toolCallId,
		writeArgs,
		{},
		undefined,
		ui,
		sandbox,
	)
	written.updateResult({ ...writeOutput, isError: false })
	const changeLines = written
		.render(PROBE_COLUMNS)
		.map(stripVTControlCharacters)
	assert.ok(
		changeLines.some(line => /- +1 │ const changed = false;/u.test(line)),
	)
	assert.ok(
		changeLines.some(line => /\+ +1 │ const changed = true;/u.test(line)),
	)
	assert.ok(changeLines.at(-1).includes('click / Ctrl+O'))
	process.stdout.write(
		'PASS: Jiti and CLI share the adapted bundle; no tool registrations.\n',
	)
} finally {
	const dispose = Reflect.get(
		prototype,
		Symbol.for('pi.renderers.installation'),
	)
	if (typeof dispose === 'function') dispose()
	rmSync(sandbox, { recursive: true, force: true })
}
