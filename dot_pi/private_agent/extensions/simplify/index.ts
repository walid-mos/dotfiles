/**
 * /simplify - deterministic scopes use the four-lens pipeline; Jev routes
 * semantic targets to the parent agent to plan and execute each requested unit.
 * The pipeline runs four fresh-eyes lenses through the installed subagents package,
 * a merge of what they returned, an autonomous pass over provable Git-scoped
 * findings, a checkpoint for the rest, and the project's gates after edits.
 *
 * This file is only the wiring: command registration, the preflight, routing,
 * scope call and notices. The stages live in pipeline.ts; grammar in
 * command-args.ts, help in command-help.ts, semantic routing and handoff in
 * target-routing.ts / target-message.ts; scope in git-scope.ts /
 * git-files.ts / git-shell.ts; lens
 * contracts in lenses.ts; child results in capture.ts; merging in findings.ts;
 * gates in verify.ts; messages in apply.ts; the dialog in select-ui.ts.
 */

import { createSubagentCapture } from './capture.ts'
import { parseCommandArgs } from './command-args.ts'
import { USAGE } from './command-help.ts'
import { collectScope } from './git-scope.ts'
import { ScopeError } from './git-shell.ts'
import { TargetResolutionError } from './git-snapshot.ts'
import { errorMessage } from './json.ts'
import { runPipeline } from './pipeline.ts'
import { emptyScopeNotice, reportRun } from './report.ts'
import { buildTargetMessage } from './target-message.ts'
import { routeTarget } from './target-routing.ts'
import { createTurnWatcher } from './turns.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { RunDeps } from './run-deps.ts'
import type { ScopeManifest, ScopeRequest } from './types.ts'

const COMMAND_DESCRIPTION =
	'Simplify a natural target or Git changes with evidence-backed fixes'

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
	const target = parsed.request.mode
	if (
		target.kind === 'target' &&
		(await routeTarget(target.query)) === 'agent'
	) {
		handOffTarget(deps, rawArgs)
		return
	}
	const collected = await collect(deps, parsed.request)
	if (!collected.ok) {
		if (
			target.kind === 'target' &&
			collected.error instanceof TargetResolutionError
		) {
			handOffTarget(deps, rawArgs)
			return
		}
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

function handOffTarget(deps: RunDeps, rawArgs: string): void {
	deps.pi.sendUserMessage(buildTargetMessage(rawArgs, deps.ctx.cwd))
}

type CollectResult =
	| { ok: true; manifest: ScopeManifest }
	| {
			ok: false
			error: unknown
			notice: string
			severity: 'warning' | 'error'
	  }

async function collect(
	deps: RunDeps,
	request: ScopeRequest,
): Promise<CollectResult> {
	try {
		return { ok: true, manifest: await collectScope(deps.ctx.cwd, request) }
	} catch (error) {
		return {
			ok: false,
			error,
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
