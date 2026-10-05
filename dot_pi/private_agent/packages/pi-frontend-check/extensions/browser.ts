import { batchStepFailure, buildActFailure } from './action-failure.ts'
import { BrowserConnection } from './browser-connection.ts'
import { browserOperation } from './browser-operation.ts'
import { actOnPage, actWithPopup, diagnoseFailure } from './page-actions.ts'
import { capturePage } from './page-capture.ts'
import { visibleControls } from './page-controls.ts'
import { observePage } from './page-events.ts'
import { navigatePage } from './page-navigation.ts'
import { describePage, extractSafeSpecimen } from './page-observation.ts'
import { capturePixelFrame } from './page-pixel-frame.ts'
import { boundedText, BrowserLog, normalizeUrl } from './report.ts'
import { SerialQueue } from './serial-queue.ts'
import {
	fillSharedLogin,
	protectLoginResult,
	redactLoginText,
} from './shared-login-browser.ts'

import type { ImageContent } from '@earendil-works/pi-ai'
import type { AgentToolResult } from '@earendil-works/pi-coding-agent'
import type { ActFailurePhase, BatchFailure } from './action-failure.ts'
import type { ActionFailure } from './action-failure.ts'
import type { ActOptions, BatchStep } from './action-schema.ts'
import type { PixelFrame } from './page-pixel-frame.ts'
import type { PageSpecimen } from './page-specimen.ts'
import type { Config, OpenOptions, ScreenshotOptions } from './schema.ts'

const JSON_INDENT = 2

export class FrontendBrowser {
	private connection: BrowserConnection
	private queue = new SerialQueue()
	private lifetime = new AbortController()
	private activeSignal: AbortSignal | undefined
	private config: Config
	private log: BrowserLog
	private secrets = new Set<string>()
	private sensitiveOrigin: string | undefined

	constructor(config: Config) {
		this.config = config
		this.log = new BrowserLog(config.MAX_CONSOLE)
		this.connection = new BrowserConnection(page =>
			observePage(page, this.log),
		)
	}

	run<Result>(
		operation: () => Promise<Result>,
		signal?: AbortSignal,
		timeoutMs = this.config.NAV_TIMEOUT_MS,
	): Promise<Result> {
		const lifetime = AbortSignal.any([
			this.lifetime.signal,
			...(signal ? [signal] : []),
		])
		return this.queue.run(
			() =>
				browserOperation(
					async active => {
						this.activeSignal = active
						try {
							return await operation()
						} finally {
							this.activeSignal = undefined
						}
					},
					() => this.close(),
					{ signal: lifetime, timeoutMs },
				),
			lifetime,
		)
	}

	redact(text: string): string {
		return redactLoginText(text, this.secrets)
	}

	protectResult<Result>(
		toolResult: AgentToolResult<Result>,
	): AgentToolResult<Result> {
		return protectLoginResult(toolResult, this.secrets)
	}

	private assertSafeScreenshot(): void {
		if (this.sensitiveOrigin)
			throw new Error(
				'Screenshot suppressed after a shared login fill in this browser session.',
			)
	}

	async fillSharedLogin(handle: string): Promise<string> {
		return fillSharedLogin(
			this.connection.currentPage(),
			handle,
			(password, origin) => {
				this.secrets.add(password)
				this.sensitiveOrigin = origin
			},
			this.activeSignal,
		)
	}

	async open(
		options: OpenOptions,
		cwd: string,
		sessionKey?: string,
	): Promise<string> {
		const url = normalizeUrl(options.url, cwd)
		const page = await this.connection.ensurePage(
			this.config,
			this.activeSignal,
			sessionKey,
		)
		this.log.clear()
		await navigatePage(page, url, options.wait_for, {
			close: () => this.close(),
			redact: text => this.redact(text),
		})
		return this.describe()
	}

	async act(options: ActOptions): Promise<string> {
		await this.performAct(options)
		return this.describe()
	}

	async actMany(steps: BatchStep[]): Promise<string> {
		const completedIds: string[] = []
		for (const [index, step] of steps.entries()) {
			// Each action may create the state consumed by the next step.
			// oxlint-disable-next-line no-await-in-loop
			await this.performAct(
				step,
				batchStepFailure(steps, index, completedIds),
			)
			completedIds.push(step.id)
		}
		return `Completed ${steps.length} frontend actions: ${completedIds.join(', ')}\n${await this.describe()}`
	}

	private async performAct(
		options: ActOptions,
		batch?: BatchFailure,
	): Promise<void> {
		try {
			const page = this.connection.currentPage()
			if (options.popup) await actWithPopup(page, options)
			else await actOnPage(page, options)
		} catch (error) {
			throw await this.failStep(options, 'action', error, batch)
		}
		try {
			if (options.wait_for)
				await this.connection
					.currentPage()
					.locator(options.wait_for)
					.waitFor({ state: 'visible' })
		} catch (error) {
			throw await this.failStep(options, 'readiness', error, batch)
		}
	}

	/** Ordinary failure: throws the failed report; an unresponsive page rethrows. */
	private async failStep(
		options: ActOptions,
		phase: ActFailurePhase,
		error: unknown,
		batch?: BatchFailure,
	): Promise<ActionFailure> {
		const diagnosis = await diagnoseFailure(
			() => this.connection.currentPage(),
			options,
			phase,
		)
		if (!diagnosis) throw error
		const failure = buildActFailure({
			options,
			phase,
			error,
			diagnosis,
			batch,
			redact: text => this.redact(text),
		})
		failure.message += `\n${await visibleControls(this.connection.currentPage(), text => this.redact(text))}`
		return failure
	}

	async describe(): Promise<string> {
		return describePage(this.connection.currentPage(), this.log, text =>
			this.redact(text),
		)
	}

	async screenshot(options: ScreenshotOptions = {}): Promise<ImageContent> {
		this.assertSafeScreenshot()
		return capturePage(this.connection.currentPage(), this.config, options)
	}

	/** Capture the exact visible state, including session-only persona and demo choices. */
	async capturePixelFrame(
		waitFor: string,
		selector?: string,
	): Promise<PixelFrame> {
		return capturePixelFrame(
			this.connection.currentPage(),
			waitFor,
			selector,
			() => this.assertSafeScreenshot(),
		)
	}

	async evaluate(expression: string): Promise<string> {
		const evaluated: unknown = await this.connection
			.currentPage()
			.evaluate(expression)
		return boundedText(
			JSON.stringify(evaluated, null, JSON_INDENT) ?? String(evaluated),
			this.config.MAX_EVAL_CHARS,
		)
	}

	/** The rendered-page specimen the spec check judges; extracted on the current page. */
	async specimen(waitFor?: string, scope?: string): Promise<PageSpecimen> {
		const page = this.connection.currentPage()
		if (waitFor) await page.locator(waitFor).waitFor({ state: 'visible' })
		return extractSafeSpecimen(page, scope, text => this.redact(text))
	}

	console(level?: string, max?: number): string {
		this.connection.currentPage()
		return this.log.format(level, max)
	}

	status(): string {
		const mode = this.config.CDP_URL
			? 'shared CDP; persistent profile'
			: 'isolated; per-session persistent profile'
		return `Browser: ${this.connection.isConnected ? 'running' : 'closed'}\nMode: ${mode}\nURL: ${this.connection.currentUrl}\n${this.log.summary()}`
	}

	async configure(config: Config): Promise<void> {
		await this.close()
		this.config = config
		this.log = new BrowserLog(config.MAX_CONSOLE)
	}

	async close(): Promise<void> {
		this.sensitiveOrigin = undefined
		try {
			await this.connection.close()
		} finally {
			this.log.clear()
		}
	}

	async shutdown(): Promise<void> {
		this.lifetime.abort(new Error('Frontend session closed.'))
		await this.queue.run(() => this.close())
	}
}
