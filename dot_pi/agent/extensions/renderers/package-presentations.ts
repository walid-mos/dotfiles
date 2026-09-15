/** Vocabulary for tools registered by packages: Galley, the browser tools and the subagent runtime. */
import { basename } from 'node:path'

import { reflectMember } from '../ui/pi-members.ts'

import {
	countLines,
	payloadNumber,
	payloadText,
	singleLine,
} from './tool-payload.ts'

import type { ToolPresentation } from './tool-presentation.ts'

type PresentTool = (args: unknown) => ToolPresentation

const MS_PER_SECOND = 1000
const PREVIEW_CHARS = 160

function subagentPresentation(args: unknown): ToolPresentation {
	const action = payloadText(args, 'action')
	const target = payloadText(args, 'agent') || payloadText(args, 'workflow')
	const subject = [action || target || 'workflow', action ? target : '']
		.filter(Boolean)
		.join(' ')
	const isAsync = !action && reflectMember(args, 'async') === true
	const annotation =
		payloadText(args, 'topic') ||
		payloadText(args, 'task') ||
		payloadText(args, 'workflowScriptPath')
	return {
		label: 'subagent',
		subject,
		annotation: [isAsync ? 'async' : '', annotation]
			.filter(Boolean)
			.join(' · '),
		summary: output => {
			const hasAsyncReceipt =
				!action && Boolean(payloadText(output.details, 'asyncId'))
			return isAsync || hasAsyncReceipt ? 'async' : countLines(output)
		},
		body: 'native',
	}
}

function galleyPresentation(args: unknown): ToolPresentation {
	const action = payloadText(args, 'action') || 'attach'
	const session = payloadText(args, 'session')
	const repo = payloadText(args, 'repo')
	return {
		label: 'galley',
		subject: [action, session].filter(Boolean).join(' '),
		annotation: repo ? basename(repo) : '',
		summary: output => {
			const connected = reflectMember(output.details, 'connected')
			if (connected === true) return 'live'
			return connected === false ? 'idle' : ''
		},
		body: 'text',
	}
}

/** Browser URLs lose their scheme for the row: the host and path identify the page. */
function browserUrlSubject(source: string): string {
	try {
		const parsed = new URL(source)
		if (!/^(?:https?|file):$/u.test(parsed.protocol)) return source
		const subject = `${parsed.host}${parsed.pathname}${parsed.search}`
		return subject.replace(/\/$/u, '') || source
	} catch {
		return source
	}
}

function frontendOpenPresentation(args: unknown): ToolPresentation {
	const waitFor = payloadText(args, 'wait_for')
	return {
		label: 'open',
		subject: browserUrlSubject(payloadText(args, 'url')) || 'page',
		annotation: waitFor ? `wait for ${waitFor}` : '',
		summary: countLines,
		body: 'text',
	}
}

function frontendActPresentation(args: unknown): ToolPresentation {
	const action = payloadText(args, 'action') || 'act'
	const target = payloadText(args, 'target')
	const waitFor = payloadText(args, 'wait_for')
	return {
		label: 'act',
		subject: [action, target || payloadText(args, 'key')]
			.filter(Boolean)
			.join(' '),
		annotation: [
			action === 'wait_for' || !waitFor ? '' : `wait for ${waitFor}`,
			reflectMember(args, 'popup') === true ? 'new tab' : '',
		]
			.filter(Boolean)
			.join(' · '),
		summary: countLines,
		body: 'text',
	}
}

function frontendScreenshotPresentation(args: unknown): ToolPresentation {
	const width = payloadNumber(args, 'width')
	const height = payloadNumber(args, 'height')
	const fullPage = reflectMember(args, 'full_page') === true
	return {
		label: 'shot',
		subject:
			payloadText(args, 'selector') ||
			(fullPage ? 'full page' : 'viewport'),
		annotation: width && height ? `${String(width)}x${String(height)}` : '',
		summary: countLines,
		body: 'text',
	}
}

function frontendConsolePresentation(args: unknown): ToolPresentation {
	const max = payloadNumber(args, 'max')
	return {
		label: 'console',
		subject: payloadText(args, 'level') || 'all levels',
		annotation: typeof max === 'number' ? `last ${String(max)}` : '',
		summary: countLines,
		body: 'text',
	}
}

function frontendEvalPresentation(args: unknown): ToolPresentation {
	return {
		label: 'eval',
		subject: singleLine(
			payloadText(args, 'expression').slice(0, PREVIEW_CHARS),
		),
		annotation: '',
		summary: countLines,
		body: 'text',
	}
}

function waitPresentation(args: unknown): ToolPresentation {
	const id = payloadText(args, 'id')
	const timeoutMs = payloadNumber(args, 'timeoutMs')
	return {
		label: 'wait',
		subject:
			id ||
			(reflectMember(args, 'all') === true ? 'all runs' : 'any run'),
		annotation:
			reflectMember(args, 'nonBlocking') === true ? 'non-blocking' : '',
		timeoutSeconds:
			typeof timeoutMs === 'number'
				? Math.round(timeoutMs / MS_PER_SECOND)
				: undefined,
		summary: countLines,
		body: 'text',
	}
}

function supervisorPresentation(args: unknown): ToolPresentation {
	const action = payloadText(args, 'action') || 'pending'
	return {
		label: 'supervisor',
		subject: [
			action,
			payloadText(args, 'to') || payloadText(args, 'replyTo'),
		]
			.filter(Boolean)
			.join(' '),
		annotation: singleLine(
			payloadText(args, 'message').slice(0, PREVIEW_CHARS),
		),
		summary: countLines,
		body: 'text',
	}
}

export const PACKAGE_PRESENTATIONS: readonly (readonly [
	string,
	PresentTool,
])[] = [
	['subagent', subagentPresentation],
	['galley_agent', galleyPresentation],
	['frontend_open', frontendOpenPresentation],
	['frontend_act', frontendActPresentation],
	['frontend_screenshot', frontendScreenshotPresentation],
	['frontend_console', frontendConsolePresentation],
	['frontend_eval', frontendEvalPresentation],
	['bg_wait', waitPresentation],
	['subagent_supervisor', supervisorPresentation],
]
