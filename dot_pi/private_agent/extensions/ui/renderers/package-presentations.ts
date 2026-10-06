/** Vocabulary for tools registered by packages: Syneva, the browser tools and the subagent runtime. */
import { basename } from 'node:path'

import { reflectMember } from '#lib/ui/pi-members.ts'

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
/** More batch steps than this collapse to first … last. */
const LISTED_STEP_IDS = 2

/** A `workflow` string holding a path separator is a script file; any other string names a resource. */
function isWorkflowScriptPath(workflow: string): boolean {
	return workflow.includes('/') || workflow.includes('\\')
}

function subagentPresentation(args: unknown): ToolPresentation {
	const action = payloadText(args, 'action')
	const workflow = payloadText(args, 'workflow')
	const workflowPath = isWorkflowScriptPath(workflow) ? workflow : ''
	const target = payloadText(args, 'agent') || (workflowPath ? '' : workflow)
	const subject = [action || target || 'workflow', action ? target : '']
		.filter(Boolean)
		.join(' ')
	const isAsync = !action && reflectMember(args, 'async') === true
	const isInlineScript = reflectMember(args, 'workflow') === true
	const scriptNote = isInlineScript ? 'inline script' : ''
	const annotation =
		payloadText(args, 'topic') ||
		payloadText(args, 'task') ||
		(workflowPath ? basename(workflowPath) : scriptNote)
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

function synevaPresentation(args: unknown): ToolPresentation {
	const action = payloadText(args, 'action') || 'attach'
	const session = payloadText(args, 'session')
	const repo = payloadText(args, 'repo')
	return {
		label: 'syneva',
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

function stepIds(args: unknown): string[] {
	const steps = reflectMember(args, 'steps')
	if (!Array.isArray(steps)) return []
	return steps.map(step => payloadText(step, 'id')).filter(Boolean)
}

function frontendBatchPresentation(args: unknown): ToolPresentation {
	const ids = stepIds(args)
	const evals = reflectMember(args, 'evals')
	const capture = payloadText(reflectMember(args, 'capture'), 'name')
	const subject =
		ids.length > LISTED_STEP_IDS
			? `${ids[0] ?? ''} … ${ids.at(-1) ?? ''} (${String(ids.length)} steps)`
			: ids.join(' · ')
	return {
		label: 'batch',
		subject: subject || 'steps',
		annotation: [
			Array.isArray(evals) && evals.length
				? `${String(evals.length)} evals`
				: '',
			capture ? `capture ${capture}` : '',
		]
			.filter(Boolean)
			.join(' · '),
		summary: countLines,
		body: 'text',
	}
}

function comparedSides(args: unknown): string {
	const first =
		payloadText(args, 'captured_a') ||
		payloadText(args, 'implementation_url')
	const second =
		payloadText(args, 'captured_b') || payloadText(args, 'baseline_url')
	return [first, second].filter(Boolean).join(' vs ')
}

function frontendComparePresentation(args: unknown): ToolPresentation {
	const mode = payloadText(args, 'mode') || 'compare'
	const subject =
		mode === 'diff'
			? comparedSides(args)
			: payloadText(args, 'name') || basename(payloadText(args, 'file'))
	return {
		label: 'compare',
		subject: [mode, subject].filter(Boolean).join(' '),
		annotation: payloadText(args, 'scope'),
		summary: countLines,
		body: 'text',
	}
}

function frontendPixelsPresentation(args: unknown): ToolPresentation {
	const mode = payloadText(args, 'mode') || 'pixels'
	const subject =
		mode === 'diff' ? comparedSides(args) : payloadText(args, 'name')
	return {
		label: 'pixels',
		subject: [mode, subject].filter(Boolean).join(' '),
		annotation: payloadText(args, 'selector'),
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
	const checks = reflectMember(args, 'checks')
	const subject = Array.isArray(checks)
		? `${String(checks.length)} checks: ${checks
				.map(check => payloadText(check, 'name'))
				.filter(Boolean)
				.join(', ')}`
		: payloadText(args, 'expression')
	return {
		label: 'eval',
		subject: singleLine(subject.slice(0, PREVIEW_CHARS)),
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
	['syneva_agent', synevaPresentation],
	['frontend_open', frontendOpenPresentation],
	['frontend_batch', frontendBatchPresentation],
	['frontend_screenshot', frontendScreenshotPresentation],
	['frontend_console', frontendConsolePresentation],
	['frontend_eval', frontendEvalPresentation],
	['frontend_compare', frontendComparePresentation],
	['frontend_pixels', frontendPixelsPresentation],
	['bg_wait', waitPresentation],
	['subagent_supervisor', supervisorPresentation],
]
