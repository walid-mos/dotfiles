import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Value } from 'typebox/value'

import { launchBrowser, openContext } from './browser-launch.ts'
import { actOnPage } from './page-actions.ts'
import { boundedText } from './report.ts'
import {
	annotateAction,
	annotateState,
	captureState,
	mergeAnnotations,
	probeStep,
} from './scenario-state.ts'
import { scenarioFileSchema } from './schema.ts'

import type { Browser, Page } from 'playwright-core'
import type { StepOutcome } from './scenario-state.ts'
import type {
	Config,
	ScenarioFile,
	ScenarioParams,
	ScenarioStep,
} from './schema.ts'

const DEFAULT_RUNS = 1
const DEFAULT_CONCURRENCY = 4
const MAX_CONCURRENCY = 16
const OUTPUT_DIR_PREFIX = 'pi-frontend-scenarios'
const REPORT_LIMIT = 16000

export interface ScenarioRunSummary {
	run: number
	completedSteps: number
	failure?: string
	stateFiles: string[]
	durationMs: number
}

interface RunContext {
	browser: Browser
	config: Config
	scenario: ScenarioFile
	outputDir: string
	index: number
}

interface PoolOptions {
	browser: Browser
	config: Config
	scenario: ScenarioFile
	outputDir: string
	runs: number
	concurrency: number
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

function describeScenarioErrors(raw: unknown): string {
	return [...Value.Errors(scenarioFileSchema, raw)]
		.map(error => `${error.instancePath || '/'} ${error.message}`)
		.join('; ')
}

export function parseScenario(raw: unknown, source: string): ScenarioFile {
	if (!Value.Check(scenarioFileSchema, raw))
		throw new Error(
			`Invalid scenario file ${source}: ${describeScenarioErrors(raw)}`,
		)
	const needsExtract = raw.steps.some(step => step.checkpoint)
	if (needsExtract && !raw.extract)
		throw new Error(
			`Invalid scenario file ${source}: checkpoint steps need an "extract" expression.`,
		)
	return raw
}

async function recordCheckpoint(
	page: Page,
	run: RunContext,
	step: ScenarioStep,
	outcome: StepOutcome,
): Promise<void> {
	if (!step.checkpoint || !run.scenario.extract) return
	const state = await captureState(
		page,
		run.scenario.extract,
		run.config.MAX_EVAL_CHARS,
	)
	const runDir = join(run.outputDir, `run-${run.index}`)
	await mkdir(runDir, { recursive: true })
	const statePath = join(runDir, `${step.id}.state.json`)
	await writeFile(
		statePath,
		annotateState(state, outcome.lastAction, outcome.lastObservation),
	)
	outcome.stateFiles.push(statePath)
}

async function recordFailure(
	page: Page,
	run: RunContext,
	step: ScenarioStep,
): Promise<void> {
	const runDir = join(run.outputDir, `run-${run.index}`)
	await mkdir(runDir, { recursive: true })
	await page
		.screenshot({ path: join(runDir, `${step.id}.png`) })
		.catch(() => undefined)
}

/** A step may ask for its own screenshot, so a passing run still leaves visual evidence. */
async function recordShot(
	page: Page,
	run: RunContext,
	step: ScenarioStep,
): Promise<void> {
	if (!step.act.screenshot) return
	const runDir = join(run.outputDir, `run-${run.index}`)
	await mkdir(runDir, { recursive: true })
	await page
		.screenshot({ path: join(runDir, `${step.id}.png`), fullPage: true })
		.catch(() => undefined)
}

async function waitForStep(page: Page, step: ScenarioStep): Promise<void> {
	if (!step.act.wait_for) return
	await page.locator(step.act.wait_for).waitFor({ state: 'visible' })
}

async function runSteps(page: Page, run: RunContext): Promise<StepOutcome> {
	let outcome: StepOutcome = { completedSteps: 0, stateFiles: [] }
	for (const step of run.scenario.steps) {
		try {
			// oxlint-disable-next-line no-await-in-loop
			const before = await probeStep(page, run.scenario.probe, step)
			// Steps drive one page in order: each action needs the previous one.
			// oxlint-disable-next-line no-await-in-loop
			await actOnPage(page, step.act)
			// oxlint-disable-next-line no-await-in-loop
			await waitForStep(page, step)
			outcome.completedSteps += 1
			// oxlint-disable-next-line no-await-in-loop
			await recordCheckpoint(page, run, step, outcome)
			// The pair travels with the action that produced it, so a checkpoint that only
			// waits still reports the action it came after.
			// oxlint-disable-next-line no-await-in-loop
			const annotations = await annotateAction(
				page,
				run.scenario.probe,
				step,
				before,
			)
			outcome = mergeAnnotations(outcome, annotations)
			// oxlint-disable-next-line no-await-in-loop
			await recordShot(page, run, step)
		} catch (error) {
			outcome.failure = `${step.id}: ${describe(error)}`
			// oxlint-disable-next-line no-await-in-loop
			await recordFailure(page, run, step)
			return outcome
		}
	}
	return outcome
}

async function withScenarioPage(run: RunContext): Promise<StepOutcome> {
	const context = await openContext(run.browser, run.config)
	try {
		const page = await context.newPage()
		// `commit` plus an explicit anchor: dev servers can take tens of seconds to reach
		// DOMContentLoaded (module waterfalls, self-reloads), and the scenario's own
		// wait_for is the real readiness criterion.
		await page.goto(run.scenario.url, { waitUntil: 'commit' })
		await page.locator('body').waitFor({ state: 'attached' })
		if (run.scenario.waitFor)
			await page
				.locator(run.scenario.waitFor)
				.waitFor({ state: 'visible' })
		return await runSteps(page, run)
	} finally {
		await context.close()
	}
}

async function runOnce(run: RunContext): Promise<ScenarioRunSummary> {
	const started = Date.now()
	const outcome = await withScenarioPage(run).catch(
		(error: unknown): StepOutcome => ({
			completedSteps: 0,
			stateFiles: [],
			failure: describe(error),
		}),
	)
	return { run: run.index, ...outcome, durationMs: Date.now() - started }
}

async function runPool(options: PoolOptions): Promise<ScenarioRunSummary[]> {
	const summaries: ScenarioRunSummary[] = []
	let next = 0
	const worker = async (): Promise<void> => {
		while (next < options.runs) {
			const index = next + 1
			next += 1
			// One page per run, sequentially; the pool is what makes runs parallel.
			// oxlint-disable-next-line no-await-in-loop
			summaries.push(await runOnce({ ...options, index }))
		}
	}
	const width = Math.min(options.concurrency, options.runs)
	await Promise.all(Array.from({ length: width }, worker))
	return summaries.toSorted((left, right) => left.run - right.run)
}

function formatRun(summary: ScenarioRunSummary): string {
	const status = summary.failure ? `FAIL ${summary.failure}` : 'ok'
	return `run ${summary.run}: ${status} | ${summary.completedSteps} steps | ${summary.stateFiles.length} states | ${summary.durationMs}ms`
}

function formatReport(
	scenarioName: string,
	outputDir: string,
	summaries: ScenarioRunSummary[],
): string {
	const states = summaries.reduce(
		(total, summary) => total + summary.stateFiles.length,
		0,
	)
	const failures = summaries.filter(summary => summary.failure).length
	const lines = [
		`scenario ${scenarioName} | ${summaries.length} runs | ${states} checkpoint states | ${failures} failed runs`,
		...summaries.map(formatRun),
		`states: ${outputDir}`,
		'Each state file is a page snapshot taken after its step; failures are app findings, not tool errors. Judge the states, then read the screenshots (run-N/<step>.png) with the read tool.',
	]
	return boundedText(lines.join('\n'), REPORT_LIMIT)
}

export async function runScenarios(
	scenarioPath: string,
	params: ScenarioParams,
	config: Config,
	signal?: AbortSignal,
): Promise<string> {
	const scenario = parseScenario(
		JSON.parse(await readFile(scenarioPath, 'utf8')),
		scenarioPath,
	)
	const runs = params.runs ?? DEFAULT_RUNS
	const concurrency = params.concurrency ?? DEFAULT_CONCURRENCY
	const outputDir =
		params.output_dir ??
		join(tmpdir(), OUTPUT_DIR_PREFIX, String(Date.now()))
	await mkdir(outputDir, { recursive: true })
	const browser = await launchBrowser(config)
	const cancel = (): void => void browser.close()
	signal?.addEventListener('abort', cancel)
	try {
		const summaries = await runPool({
			browser,
			config,
			scenario,
			outputDir,
			runs,
			concurrency: Math.min(concurrency, MAX_CONCURRENCY),
		})
		return formatReport(scenario.name ?? scenarioPath, outputDir, summaries)
	} finally {
		signal?.removeEventListener('abort', cancel)
		await browser.close()
	}
}
