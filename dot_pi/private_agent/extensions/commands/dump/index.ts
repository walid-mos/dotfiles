/**
 * /dump snapshots the complete session tree and the latest in-flight output.
 * Pi events own the live assistant/tool state; the session manager owns history.
 * The ordered above-editor widget reports the saved file and clipboard result.
 */
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
	buildSessionContext,
	copyToClipboard,
} from '@earendil-works/pi-coding-agent'
import { truncateToWidth } from '@earendil-works/pi-tui'

import { isHumanPrompt } from '#lib/human-prompt.ts'
import {
	ABOVE_EDITOR_PRIORITY,
	setOrderedAboveEditorWidget,
} from '#lib/ui/ordered-widget-stack.ts'

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionUIContext,
	MessageUpdateEvent,
} from '@earendil-works/pi-coding-agent'

const JSON_INDENT = 2
const WIDGET_ID = 'session-dump'
const FILE_NAME = 'session.json'

type ActiveTool = {
	name: string
	args: unknown
	startedAt: string
	partialResult?: unknown
}

type LiveOutput = {
	assistant: MessageUpdateEvent['message'] | undefined
	assistantEvent: unknown
	assistantUpdatedAt: string | undefined
	tools: Record<string, ActiveTool>
}

function showDumpStatus(ui: ExtensionUIContext, lines: string[]): void {
	setOrderedAboveEditorWidget(ui, WIDGET_ID, {
		priority: ABOVE_EDITOR_PRIORITY.dump,
		render: (width, theme) =>
			lines.map(line => truncateToWidth(theme.fg('muted', line), width)),
	})
}

function runtimeSnapshot(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
): object {
	return {
		pid: process.pid,
		node: process.version,
		cwd: ctx.cwd,
		isStreaming: !ctx.isIdle(),
		hasPendingMessages: ctx.hasPendingMessages(),
		model: ctx.model && { provider: ctx.model.provider, id: ctx.model.id },
		thinkingLevel: ctx.thinkingLevel,
		contextUsage: ctx.getContextUsage(),
		activeTools: pi.getActiveTools(),
		availableTools: pi.getAllTools(),
		commands: pi.getCommands(),
		scopedModels: ctx.scopedModels.map(({ model, thinkingLevel }) => ({
			provider: model.provider,
			id: model.id,
			thinkingLevel,
		})),
	}
}

function captureSession(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	live: LiveOutput,
): string {
	const session = ctx.sessionManager
	const entries = session.getEntries()
	return JSON.stringify(
		{
			capturedAt: new Date().toISOString(),
			runtime: runtimeSnapshot(pi, ctx),
			session: {
				header: session.getHeader(),
				id: session.getSessionId(),
				file: session.getSessionFile(),
				name: session.getSessionName(),
				leafId: session.getLeafId(),
				branchEntryIds: session.getBranch().map(entry => entry.id),
				modelContext: buildSessionContext(entries, session.getLeafId()),
				entries,
			},
			prompt: {
				system: ctx.getSystemPrompt(),
				options: ctx.getSystemPromptOptions(),
			},
			inFlight: live,
		},
		null,
		JSON_INDENT,
	)
}

async function saveDump(
	ui: ExtensionUIContext,
	snapshot: string,
	isLatest: () => boolean,
	isDismissed: () => boolean,
): Promise<void> {
	let filePath: string | undefined
	let isSaved = false
	try {
		const directory = await mkdtemp(join(tmpdir(), 'pi-dump-'))
		filePath = join(directory, FILE_NAME)
		await writeFile(filePath, `${snapshot}\n`, { mode: 0o600 })
		isSaved = true
		if (!isLatest()) return
		await copyToClipboard(snapshot)
		if (isLatest() && !isDismissed()) {
			showDumpStatus(ui, [
				'DUMP  Session JSON copied to clipboard',
				filePath,
				'Review for secrets before sharing. Run /dump again to refresh.',
			])
		}
	} catch (error) {
		if (!isLatest()) return
		const lines = [
			`DUMP  ${isSaved ? 'Clipboard failed; saved file' : 'Save failed'}`,
			...(isSaved && filePath ? [filePath] : []),
			String(error),
		]
		if (isDismissed()) ui.notify(lines.join('\n'), 'error')
		else showDumpStatus(ui, lines)
	}
}

function trackLiveOutput(pi: ExtensionAPI): {
	capture: () => LiveOutput
	clear: () => void
} {
	let assistant: MessageUpdateEvent['message'] | undefined
	let assistantEvent: unknown
	let assistantUpdatedAt: string | undefined
	const tools = new Map<string, ActiveTool>()
	const clear = (): void => {
		assistant = undefined
		assistantEvent = undefined
		assistantUpdatedAt = undefined
		tools.clear()
	}
	pi.on('message_update', event => {
		assistant = event.message
		assistantEvent = event.assistantMessageEvent
		assistantUpdatedAt = new Date().toISOString()
	})
	pi.on('tool_execution_start', event => {
		tools.set(event.toolCallId, {
			name: event.toolName,
			args: event.args,
			startedAt: new Date().toISOString(),
		})
	})
	pi.on('tool_execution_update', event => {
		const tool = tools.get(event.toolCallId)
		if (tool) tool.partialResult = event.partialResult
	})
	pi.on('tool_execution_end', event => {
		tools.delete(event.toolCallId)
	})
	pi.on('agent_end', clear)
	return {
		clear,
		capture: () => ({
			assistant,
			assistantEvent,
			assistantUpdatedAt,
			tools: Object.fromEntries(tools),
		}),
	}
}

export default function dump(pi: ExtensionAPI): void {
	const live = trackLiveOutput(pi)
	let generation = 0
	let isDismissed = true

	pi.on('session_start', (_event, ctx) => {
		generation++
		isDismissed = true
		live.clear()
		if (ctx.mode === 'tui')
			setOrderedAboveEditorWidget(ctx.ui, WIDGET_ID, undefined)
	})
	pi.on('session_shutdown', (_event, ctx) => {
		generation++
		isDismissed = true
		if (ctx.mode === 'tui')
			setOrderedAboveEditorWidget(ctx.ui, WIDGET_ID, undefined)
	})
	pi.on('input', (event, ctx) => {
		if (!isHumanPrompt(event)) return
		isDismissed = true
		if (ctx.mode === 'tui')
			setOrderedAboveEditorWidget(ctx.ui, WIDGET_ID, undefined)
	})

	pi.registerCommand('dump', {
		description:
			'Copy a fresh session snapshot (including live output) and save its JSON file',
		handler: async (_args, ctx) => {
			const currentGeneration = ++generation
			isDismissed = false
			if (ctx.mode === 'tui')
				showDumpStatus(ctx.ui, ['DUMP  Capturing session...'])
			try {
				const snapshot = captureSession(pi, ctx, live.capture())
				void saveDump(
					ctx.ui,
					snapshot,
					() => generation === currentGeneration,
					() => isDismissed,
				)
			} catch (error) {
				if (ctx.mode === 'tui')
					showDumpStatus(ctx.ui, [
						`DUMP  Capture failed: ${String(error)}`,
					])
			}
		},
	})
}
