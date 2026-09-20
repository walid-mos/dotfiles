/**
 * /simplify - one command, one pipeline: a deterministic git scope, three
 * fresh-eyes lenses through the installed subagents package, a merge of what
 * they returned, an autonomous pass over the provable findings, a checkpoint
 * for the rest, and the repository's own gates after every edit.
 *
 * This file is only the wiring: command registration, the preflight, the scope
 * call and the notices. The stages live in pipeline.ts; grammar in
 * command-args.ts; scope in git-scope.ts / git-files.ts / git-shell.ts; lens
 * contracts in lenses.ts; child results in capture.ts; merging in findings.ts;
 * gates in verify.ts; messages in apply.ts; the dialog in select-ui.ts.
 */

import { createSubagentCapture } from './capture.ts'
import { parseCommandArgs, USAGE } from './command-args.ts'
import { collectScope } from './git-scope.ts'
import { ScopeError } from './git-shell.ts'
import { errorMessage } from './json.ts'
import { runPipeline } from './pipeline.ts'
import { emptyScopeNotice, reportRun } from './report.ts'
import { createTurnWatcher } from './turns.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { RunDeps } from './run-deps.ts'
import type { ScopeManifest, ScopeRequest } from './types.ts'

const COMMAND_DESCRIPTION =
	'Simplify the changed code: three lenses, evidence-backed fixes, verified'

export default function simplify(pi: ExtensionAPI): void {
	const capture = createSubagentCapture()
	const turns = createTurnWatcher(pi)
	pi.on('tool_execution_end', event => capture.record(event))
	pi.on('session_shutdown', () => turns.dispose())
	pi.registerCommand('simplify', {
		description: COMMAND_DESCRIPTION,
		handler: async (args, ctx) => {
			await runSimplify({ pi, ctx, capture, turns }, args)
		},
	})
}

async function runSimplify(deps: RunDeps, rawArgs: string): Promise<void> {
	const { ctx } = deps
	const parsed = parseCommandArgs(rawArgs)
	if (parsed.kind === 'help') {
		ctx.ui.notify(USAGE, 'info')
		return
	}
	if (parsed.kind === 'error') {
		ctx.ui.notify(`${parsed.message}\n\n${USAGE}`, 'warning')
		return
	}
	const refusal = preflight(deps)
	if (refusal) {
		ctx.ui.notify(refusal, 'warning')
		return
	}
	const collected = await collect(deps, parsed.request)
	if (!collected.ok) {
		ctx.ui.notify(collected.notice, collected.severity)
		return
	}
	if (!collected.manifest.files.length) {
		ctx.ui.notify(emptyScopeNotice(collected.manifest), 'info')
		return
	}
	await runStages(deps, collected.manifest, parsed.request.focus)
}

function preflight(deps: RunDeps): string | undefined {
	const { ctx, pi } = deps
	if (!ctx.hasUI) return 'simplify needs an interactive session.'
	if (!ctx.isIdle())
		return 'simplify: the agent is busy. Wait for it to settle, then run /simplify again.'
	if (pi.getAllTools().some(tool => tool.name === 'subagent'))
		return undefined
	return 'simplify needs the pi-subagents package: this session has no subagent tool.'
}

type CollectResult =
	| { ok: true; manifest: ScopeManifest }
	| { ok: false; notice: string; severity: 'warning' | 'error' }

async function collect(
	deps: RunDeps,
	request: ScopeRequest,
): Promise<CollectResult> {
	try {
		return { ok: true, manifest: await collectScope(deps.ctx.cwd, request) }
	} catch (error) {
		return {
			ok: false,
			notice: `simplify: ${errorMessage(error)}`,
			severity: error instanceof ScopeError ? 'warning' : 'error',
		}
	}
}

async function runStages(
	deps: RunDeps,
	manifest: ScopeManifest,
	focus: string | undefined,
): Promise<void> {
	const { ctx } = deps
	ctx.ui.setStatus('simplify', `analysing ${manifest.files.length} file(s)`)
	try {
		const pipeline = await runPipeline(deps, manifest, focus)
		if (!pipeline.ok) {
			ctx.ui.notify(pipeline.notice, 'error')
			return
		}
		reportRun(ctx, { manifest, ...pipeline.tally })
	} finally {
		ctx.ui.setStatus('simplify', undefined)
	}
}
