/**
 * /usage - cost, calls, batching and failure counters for this session, or
 * across the session files of the last N days (`/usage all [days]`).
 * Read-only: the session manager owns history and pi's usage fields own the
 * cost; this command only reduces them into an above-editor widget that the
 * next human prompt retires.
 *
 * Modules:
 *   report.ts - pure: the reducer over entries and the text rendering
 */
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

import { getAgentDir } from '@earendil-works/pi-coding-agent'
import { truncateToWidth } from '@earendil-works/pi-tui'

import { readCheckpointSettings } from '#lib/context-budget/model.ts'
import { isHumanPrompt } from '#lib/human-prompt.ts'
import {
	ABOVE_EDITOR_PRIORITY,
	setOrderedAboveEditorWidget,
} from '#lib/ui/ordered-widget-stack.ts'

import { UsageTally } from './report.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'

const WIDGET_ID = 'usage'
const DEFAULT_DAYS = 7
const MAX_DAYS = 90
const MS_PER_DAY = 86_400_000

/** The configured checkpoint ceiling; unreadable settings count nothing as over. */
function contextCeiling(): number {
	try {
		return readCheckpointSettings().maxContextTokens
	} catch {
		return Number.POSITIVE_INFINITY
	}
}

async function sessionFiles(directory: string): Promise<string[]> {
	try {
		const names = await readdir(directory)
		return names
			.filter(name => name.endsWith('.jsonl'))
			.map(name => join(directory, name))
	} catch {
		return []
	}
}

/** Session files touched since `since`, across every project directory. */
async function recentSessionFiles(since: number): Promise<string[]> {
	const root = join(getAgentDir(), 'sessions')
	const directories = await readdir(root)
	const files = await Promise.all(
		directories.map(name => sessionFiles(join(root, name))),
	)
	const recent = await Promise.all(
		files
			.flat()
			.map(async path =>
				(await stat(path)).mtimeMs >= since ? path : '',
			),
	)
	return recent.filter(Boolean)
}

async function tallyFile(tally: UsageTally, path: string): Promise<void> {
	tally.countSession()
	const lines = createInterface({
		input: createReadStream(path, 'utf8'),
		crlfDelay: Number.POSITIVE_INFINITY,
	})
	for await (const line of lines) {
		try {
			tally.observe(JSON.parse(line))
		} catch {
			// A partial trailing line of a live session is not evidence.
		}
	}
}

async function scanSessions(
	days: number,
	ceiling: number,
): Promise<UsageTally> {
	const tally = new UsageTally(ceiling)
	const files = await recentSessionFiles(Date.now() - days * MS_PER_DAY)
	await Promise.all(files.map(path => tallyFile(tally, path)))
	return tally
}

function show(ctx: ExtensionContext, lines: string[]): void {
	if (ctx.mode !== 'tui') {
		ctx.ui.notify(lines.join('\n'), 'info')
		return
	}
	setOrderedAboveEditorWidget(ctx.ui, WIDGET_ID, {
		priority: ABOVE_EDITOR_PRIORITY.usage,
		render: (width, theme) =>
			lines.map(line => truncateToWidth(theme.fg('muted', line), width)),
	})
}

function dismiss(ctx: ExtensionContext): void {
	if (ctx.mode === 'tui')
		setOrderedAboveEditorWidget(ctx.ui, WIDGET_ID, undefined)
}

export default function usage(pi: ExtensionAPI): void {
	pi.on('session_start', (_event, ctx) => dismiss(ctx))
	pi.on('session_shutdown', (_event, ctx) => dismiss(ctx))
	pi.on('input', (event, ctx) => {
		if (isHumanPrompt(event)) dismiss(ctx)
	})
	pi.registerCommand('usage', {
		description:
			'Cost, calls, batching and failure counters: this session, or `all [days]` across session files',
		handler: async (args, ctx) => {
			const [scope, daysText] = args.trim().split(/\s+/)
			const ceiling = contextCeiling()
			if (scope === 'all') {
				const days = Math.min(
					MAX_DAYS,
					Math.max(1, Number(daysText) || DEFAULT_DAYS),
				)
				show(ctx, [
					`USAGE  scanning the session files of the last ${days} days…`,
				])
				const tally = await scanSessions(days, ceiling)
				show(
					ctx,
					tally.render(
						`last ${days} days · ${tally.sessions} sessions`,
					),
				)
				return
			}
			if (scope) throw new Error('Usage: /usage or /usage all [days]')
			const tally = new UsageTally(ceiling)
			tally.countSession()
			for (const entry of ctx.sessionManager.getBranch())
				tally.observe(entry)
			show(ctx, tally.render('this session'))
		},
	})
}
