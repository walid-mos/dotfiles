/**
 * The analysis stage: write the lens tasks to disk, ask the parent model to
 * launch the fanout, and read what the children returned. Every failure comes
 * back as a notice - a dead lens never looks like a clean bill of health.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { loadConfig } from '../lazy-tools/index.ts'
import { resolvePlan } from '../lazy-tools/policy.ts'

import { childrenByKey, SUBAGENT_TOOL } from './capture.ts'
import { mergeFindings, parseLensPayload } from './findings.ts'
import { buildDispatchMessage, buildWorkflowScript, LENSES } from './lenses.ts'
import { applyOutcome } from './pipeline-apply.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { CapturedChild, CaptureState } from './capture.ts'
import type { LensResult } from './findings.ts'
import type { RunTally } from './report.ts'
import type { RunDeps } from './run-deps.ts'
import type { AnalysisOutcome, LensFailure, ScopeManifest } from './types.ts'

export type PipelineOutcome =
	| { ok: true; tally: RunTally }
	| { ok: false; notice: string }

type AnalysisAttempt =
	| { ok: true; outcome: AnalysisOutcome }
	| { ok: false; notice: string }

export async function runPipeline(
	deps: RunDeps,
	manifest: ScopeManifest,
	focus: string | undefined,
): Promise<PipelineOutcome> {
	const analysis = await analyse(deps, manifest, focus)
	if (!analysis.ok) return analysis
	return await applyOutcome(deps, manifest, analysis.outcome)
}

/** Bring the deferred `subagent` schema back before the dispatch turn, so the
 * dispatch message never has to ask the model to call `load_tools` first.
 * Additive on the live set; refuses when the lazy-tools plan does not merely
 * defer the tool (explicit `off`, or not registered at all). Returns the
 * refusal reason, or undefined when the tool is callable. */
function ensureSubagentActive(
	pi: ExtensionAPI,
	cwd: string,
): string | undefined {
	const active = pi.getActiveTools()
	if (active.includes(SUBAGENT_TOOL)) return undefined
	const plan = resolvePlan(
		loadConfig(),
		cwd,
		pi.getAllTools().map(tool => tool.name),
	)
	if (plan.deferred.includes(SUBAGENT_TOOL)) {
		// Additive only: pi applies the change before the next request.
		pi.setActiveTools([...new Set([...active, SUBAGENT_TOOL])])
		return undefined
	}
	return plan.disabled.includes(SUBAGENT_TOOL)
		? 'the lazy-tools config disables the `subagent` tool in this project.'
		: 'the `subagent` tool is not registered in this session.'
}

async function analyse(
	deps: RunDeps,
	manifest: ScopeManifest,
	focus: string | undefined,
): Promise<AnalysisAttempt> {
	const directory = await mkdtemp(path.join(tmpdir(), 'pi-simplify-'))
	try {
		const scriptPath = await writeAnalysisFiles(directory, manifest, focus)
		deps.capture.reset()
		const refusal = ensureSubagentActive(deps.pi, deps.ctx.cwd)
		if (refusal)
			return {
				ok: false,
				notice: `simplify: the lens analysis cannot run because ${refusal} Nothing was changed.`,
			}
		const settled = await deps.turns.run(() =>
			deps.pi.sendUserMessage(buildDispatchMessage(scriptPath)),
		)
		await deps.ctx.waitForIdle()
		if (!(settled === 'timeout'))
			return readOutcome(deps.capture.read(), manifest)
		return {
			ok: false,
			notice: 'simplify: the analysis run never settled, so it was abandoned. Nothing was changed.',
		}
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}

async function writeAnalysisFiles(
	directory: string,
	manifest: ScopeManifest,
	focus: string | undefined,
): Promise<string> {
	const manifestPath = path.join(directory, 'scope.json')
	const scriptPath = path.join(directory, 'workflow.js')
	const input = { manifest, manifestPath }
	const script = buildWorkflowScript(focus ? { ...input, focus } : input)
	await writeFile(manifestPath, JSON.stringify(manifest), 'utf8')
	await writeFile(scriptPath, script, 'utf8')
	return scriptPath
}

function readOutcome(
	state: CaptureState,
	manifest: ScopeManifest,
): AnalysisAttempt {
	if (!state.children.length)
		return {
			ok: false,
			notice: `simplify: no lens result came back (${describeCapture(state)}). Nothing was changed.`,
		}
	const byKey = childrenByKey(state, LENSES)
	const lensResults: LensResult[] = []
	const failures: LensFailure[] = []
	for (const lens of LENSES) {
		const child = byKey.get(lens)
		if (!child) {
			failures.push({ lens, reason: 'no result was returned' })
			continue
		}
		const problem = childProblem(child)
		if (problem) {
			failures.push({ lens, reason: problem })
			continue
		}
		const parsed = parseLensPayload(lens, child.structuredOutput)
		if (!parsed.ok) {
			failures.push({ lens, reason: parsed.reason })
			continue
		}
		lensResults.push({ lens, payload: parsed.payload })
	}
	if (lensResults.length)
		return {
			ok: true,
			outcome: mergeFindings({ manifest, lensResults, failures }),
		}
	return {
		ok: false,
		notice: `simplify: every lens failed (${describeFailures(failures)}). Nothing was changed.`,
	}
}

/** Why a returned child cannot be used, or an empty string when it can. */
function childProblem(child: CapturedChild): string {
	if (child.error) return child.error
	if (child.structuredOutputFailed)
		return 'the child finished without a valid structured_output payload'
	if (child.isStructuredOutputPresent) return ''
	return 'the child finished without a structured_output payload'
}

function describeFailures(failures: readonly LensFailure[]): string {
	return failures
		.map(failure => `${failure.lens}: ${failure.reason}`)
		.join('; ')
}

function describeCapture(state: CaptureState): string {
	const parts = [`${state.calls} subagent call(s)`]
	if (state.children.length)
		parts.push(`${state.children.length} child result(s)`)
	parts.push(...state.shapeErrors)
	return parts.join(', ')
}
