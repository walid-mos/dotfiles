// Session-log scanner behind `tool-call-audit.ts`: it turns the raw JSONL into
// one record per bash/host call, with the guard's own verdicts attached.
//
// The sleep and shadow classifications come from extensions/tool-guard - the same
// code that blocks such calls - so the audit cannot drift from the rule it
// measures.

import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'

import {
	blindWaitReason,
	shadowedCommands,
} from '../extensions/tool-guard/policy.ts'
import {
	leadingCommand,
	parseShellText,
	segments,
} from '../extensions/tool-guard/shell-text.ts'

const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3600
const SECONDS_PER_DAY = 86400
const DAY_MS = SECONDS_PER_DAY * MS_PER_SECOND

const SESSION_ROOT = join(homedir(), '.pi', 'agent', 'sessions')
const COMMAND_TOOLS = new Set(['bash', 'host'])

type ShadowedCommand = ReturnType<typeof shadowedCommands>[number]

export type Call = {
	id: string
	session: string
	at: string
	tool: string
	command: string
	waitSeconds: number
	requestedWait: boolean
	shadowed: ShadowedCommand[]
	durationMs: number
	wasAborted: boolean
}

export type Scan = {
	files: number
	calls: Call[]
	toolUse: Map<string, number>
	sessions: Set<string>
}

type Context = {
	session: string
	since: number
	scan: Scan
	byId: Map<string, Call>
}

/** Every session log under `sessions/`, newest layout included. */
export function scanSessions(since: number): Scan {
	const scan: Scan = {
		files: 0,
		calls: [],
		toolUse: new Map(),
		sessions: new Set(),
	}
	const byId = new Map<string, Call>()
	const files = sessionFiles()
	scan.files = files.length
	for (const file of files) {
		readSessionLog(file, {
			session: relative(SESSION_ROOT, file).split('/')[0] ?? '',
			since,
			scan,
			byId,
		})
	}
	return scan
}

/** Every session log under `sessions/`, newest layout included. */
export function sessionFiles(): string[] {
	return walk(SESSION_ROOT)
}

/** The days a timestamp covers, when `--days` was given. */
export function sinceFromArgs(argv: string[]): number {
	const index = argv.indexOf('--days')
	const days = index === -1 ? 0 : Number(argv[index + 1] ?? 0)
	return days > 0 ? Date.now() - days * DAY_MS : 0
}

function walk(directory: string, files: string[] = []): string[] {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name)
		if (entry.isDirectory()) walk(path, files)
		else if (entry.name.endsWith('.jsonl')) files.push(path)
	}
	return files
}

/** Host-level waits, unit-aware; guest and keep-alive delays never reach here. */
function hostWaitSeconds(command: string): number {
	let total = 0
	for (const segment of segments(parseShellText(command))) {
		const { name, args } = leadingCommand(segment)
		if (name !== 'sleep') continue
		total += sleepAmount(args[0] ?? '')
	}
	return total
}

function sleepAmount(argument: string): number {
	const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(argument)
	if (!match) return 0
	const [, digits, unit] = match
	const amount = Number.parseFloat(digits ?? '')
	if (unit === 'ms') return amount / MS_PER_SECOND
	if (unit === 'm') return amount * SECONDS_PER_MINUTE
	if (unit === 'h') return amount * SECONDS_PER_HOUR
	return amount
}

type ToolCallPart = {
	id?: string
	type?: string
	name?: string
	arguments?: unknown
}

function isToolCallPart(part: unknown): part is ToolCallPart {
	const type =
		part && typeof part === 'object' ? Reflect.get(part, 'type') : undefined
	return type === 'toolCall'
}

function partsOf(content: unknown): ToolCallPart[] {
	if (!Array.isArray(content)) return []
	return content.filter(isToolCallPart)
}

function commandArgument(argumentsValue: unknown): string {
	if (!argumentsValue || typeof argumentsValue !== 'object') return ''
	const command = Reflect.get(argumentsValue, 'command')
	return typeof command === 'string' ? command : ''
}

function callFrom(session: string, at: string, part: ToolCallPart): Call {
	const command = commandArgument(part.arguments)
	return {
		id: part.id ?? '',
		session,
		at,
		tool: part.name ?? '',
		command,
		waitSeconds: hostWaitSeconds(command),
		requestedWait: Boolean(blindWaitReason(command)),
		shadowed: shadowedCommands(command),
		durationMs: 0,
		wasAborted: false,
	}
}

function readSessionLog(file: string, context: Context): void {
	for (const line of readFileSync(file, 'utf8').split('\n'))
		readLine(line, context)
}

function readLine(line: string, context: Context): void {
	if (!line.includes('"toolCall"') && !line.includes('"toolResult"')) return
	const record = parseRecord(line)
	if (!record) return
	const at = record.timestamp ?? ''
	if (context.since > 0 && Date.parse(at) < context.since) return
	const { toolName, toolCallId } = record.message ?? {}
	if (toolName)
		recordResult(
			toolCallId,
			at,
			context.byId,
			isAborted(record.message?.content),
		)
	collectCalls(context, at, record.message?.content)
}

function collectCalls(context: Context, at: string, content: unknown): void {
	for (const part of partsOf(content)) {
		if (!part.name || !part.id) continue
		context.scan.sessions.add(context.session)
		const seen = context.scan.toolUse.get(part.name) ?? 0
		context.scan.toolUse.set(part.name, seen + 1)
		if (!COMMAND_TOOLS.has(part.name)) continue
		const call = callFrom(context.session, at, part)
		context.scan.calls.push(call)
		context.byId.set(call.id, call)
	}
}

type LogRecord = {
	timestamp?: string
	message?: { content?: unknown; toolName?: string; toolCallId?: string }
}

function parseRecord(line: string): LogRecord | undefined {
	try {
		return JSON.parse(line)
	} catch {
		return undefined
	}
}

/** `Command aborted` is what pi records when a running call is interrupted. */
function isAborted(content: unknown): boolean {
	return JSON.stringify(content ?? '').includes('Command aborted')
}

/**
 * A result's timestamp minus its call's timestamp. This is an upper bound: the
 * gap also covers any idle time before the result was written, so an aborted
 * call looks like a very long one.
 */
function recordResult(
	id: string | undefined,
	at: string,
	byId: Map<string, Call>,
	wasAborted: boolean,
): void {
	const call = id ? byId.get(id) : undefined
	if (!call) return
	const started = Date.parse(call.at)
	const finished = Date.parse(at)
	if (Number.isNaN(started) || Number.isNaN(finished)) return
	call.durationMs = Math.max(0, finished - started)
	call.wasAborted = wasAborted
}
