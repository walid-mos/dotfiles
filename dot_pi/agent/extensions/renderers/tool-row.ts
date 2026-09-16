/** One row's presentation lifecycle. Pi owns execution and expansion; this object owns only timing and details. */
import { Container } from '@earendil-works/pi-tui'

import { renderActivityLine } from '../ui/activity-line.ts'
import { renderPiComponent } from '../ui/pi-members.ts'
import { ToolPanel } from '../ui/tool-panel.ts'

import { ToolChanges } from './tool-changes.ts'
import { ToolDetails } from './tool-details.ts'
import { recalledToolDuration, rememberToolDuration } from './tool-durations.ts'
import { ToolLifecycle } from './tool-lifecycle.ts'
import { failureSummary, isCancelledOutput } from './tool-outcome.ts'
import { countLines, toolOutput } from './tool-payload.ts'
import { outputWarning, presentTool } from './tool-presentation.ts'

import type { Theme } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'
import type { ActivityClock } from '../ui/activity-clock.ts'
import type { ActivityLine } from '../ui/activity-line.ts'
import type { RenderContext } from './tool-details.ts'
import type { ToolOutput } from './tool-payload.ts'
import type { ToolPresentation } from './tool-presentation.ts'

/** Stable empty image list: a per-frame `[]` would defeat the rendered-line reuse. */
const NO_IMAGES: readonly unknown[] = []

export class ToolRow {
	private readonly lifecycle = new ToolLifecycle()
	private readonly details: ToolDetails
	private readonly changes: ToolChanges
	private toolResult: unknown
	private output: ToolOutput | undefined
	private presentation: ToolPresentation
	private images: readonly unknown[] = NO_IMAGES
	private summary = ''
	private warning = ''
	private reusedLines: readonly string[] | undefined
	private reusedWidth = -1

	private readonly name: string
	private readonly clock: ActivityClock
	private readonly repaint: () => void

	constructor(
		name: string,
		nativeDefinition: unknown,
		clock: ActivityClock,
		repaint: () => void,
	) {
		this.name = name
		this.clock = clock
		this.repaint = repaint
		this.details = new ToolDetails(nativeDefinition)
		this.changes = new ToolChanges(name)
		this.presentation = presentTool(name, undefined)
	}

	update(toolResult: unknown): void {
		if (toolResult === this.toolResult) return
		this.toolResult = toolResult
		this.output = toolOutput(toolResult)
	}

	/** Native image components for this result; Pi owns their data and conversion. */
	updateImages(images: unknown): void {
		const next: readonly unknown[] = Array.isArray(images)
			? images
			: NO_IMAGES
		if (next === this.images) return
		this.images = next
		this.reusedLines = undefined
	}

	call(args: unknown, theme: Theme, context: RenderContext): Component {
		// Pi only re-invokes a call renderer when the row changes, so this is the one
		// place where the previous frame's lines are known to be stale.
		this.reusedLines = undefined
		this.presentation = presentTool(this.name, args)
		this.observe(context)
		this.changes.update(args, this.toolResult, context)
		const details = this.details.build({
			mode: this.presentation.body,
			output: this.output,
			toolResult: this.toolResult,
			theme,
			context: this.showsChanges()
				? { ...context, expanded: false }
				: context,
			layout: this.isMutation() ? 'plain' : 'rail',
		})
		if (this.isMutation())
			return this.reusingRenderedLines(
				new ToolPanel(
					() => this.activityView(context.toolCallId),
					this.showsChanges() ? this.changes : details,
					this.changes.renderFooter() ||
						`click / Ctrl+O to ${context.expanded ? 'fold' : 'expand'}`,
					{ now: this.clock.now },
				),
			)
		const content = this.rowContent(context, details)
		// Pi only publishes image components after the call renderer ran: the
		// capture panel takes over on the render that sees them.
		const panel = new ToolPanel(
			() => this.activityView(context.toolCallId),
			details,
			this.captureFooter(context),
			{
				kind: 'capture',
				now: this.clock.now,
				raw: width => this.imageLines(width),
			},
		)
		return this.reusingRenderedLines({
			render: width =>
				(this.images.length ? panel : content).render(width),
			invalidate: () => {
				content.invalidate()
				panel.invalidate()
			},
			handleMouse: event =>
				(this.images.length ? panel : content).handleMouse?.(event),
		})
	}

	/** Pi lays out the whole transcript on every frame, so an uncached row re-measures its
	 * text on each one: `renderActivityLine` alone costs ~22µs, i.e. ~93% of a core for a
	 * 500-row transcript at the 120ms pulse.
	 *
	 * Lines are reused until the row changes, so anything that reads live state must be
	 * invalidated by whoever drives it: `call` drops the lines on every row change, and the
	 * activity pulse invalidates the running rows - the only animated ones. */
	private reusingRenderedLines(component: Component): Component {
		return {
			render: (width: number): string[] => {
				if (!this.reusedLines || this.reusedWidth !== width) {
					this.reusedLines = component.render(width)
					this.reusedWidth = width
				}
				return [...this.reusedLines]
			},
			invalidate: (): void => {
				this.reusedLines = undefined
				component.invalidate()
			},
			handleMouse: event => component.handleMouse?.(event),
		}
	}

	private rowContent(context: RenderContext, details: Component): Container {
		const content = new Container()
		content.addChild({
			render: width => [
				renderActivityLine(
					this.activityView(context.toolCallId),
					width,
					this.clock.now(),
				),
			],
			invalidate() {
				/* Header reads live state on each render. */
			},
		})
		if (context.expanded) content.addChild(details)
		return content
	}

	isMutation(): boolean {
		return this.changes.isMutation()
	}

	showsChanges(): boolean {
		return this.changes.isVisible()
	}

	private captureFooter(context: RenderContext): string {
		return [
			this.output ? countLines(this.output) : '',
			`click / Ctrl+O to ${context.expanded ? 'fold' : 'expand'}`,
		]
			.filter(Boolean)
			.join(' · ')
	}

	/** One blank framed row separates the status strip from the captures. */
	private imageLines(width: number): string[] {
		const captures = this.images.flatMap(image => {
			try {
				return renderPiComponent(image, width)
			} catch {
				return []
			}
		})
		return captures.length ? ['', ...captures] : []
	}

	private activityView(toolCallId: string): ActivityLine {
		return {
			...this.presentation,
			...this.view(toolCallId),
			summary: this.summary,
			warning: this.warning,
		}
	}

	private view(toolCallId: string): ReturnType<ToolLifecycle['view']> {
		const current = this.lifecycle.view(this.clock.now())
		return {
			...current,
			elapsedMs:
				current.elapsedMs ??
				recalledToolDuration(toolCallId, this.toolResult),
		}
	}

	private observe(context: RenderContext): void {
		const isCancelled = isCancelledOutput(this.output)
		this.lifecycle.observe(
			{
				isStarted: context.executionStarted,
				isPartial: context.isPartial,
				hasResult: Boolean(this.output),
				isError: context.isError,
				isCancelled,
			},
			this.clock.now(),
		)
		const { phase, elapsedMs } = this.lifecycle.view(this.clock.now())
		if (phase !== 'running' && phase !== 'queued')
			rememberToolDuration(context.toolCallId, this.toolResult, elapsedMs)
		if (phase === 'running') this.clock.watch(this, this.tick)
		else this.clock.release(this)
		this.summary = this.summarize(phase)
		this.warning = this.output ? outputWarning(this.output) : ''
	}

	/** One pulse tick: only this row drops its lines, and Pi then renders the shared frame. */
	private readonly tick = (): void => {
		this.reusedLines = undefined
		this.repaint()
	}

	private summarize(phase: string): string {
		if (
			phase === 'running' &&
			this.output &&
			this.presentation.body === 'text' &&
			(this.output.text.trim() || this.output.imageCount)
		)
			return this.presentation.summary(this.output)
		if (phase === 'running' || phase === 'queued' || phase === 'cancelled')
			return ''
		if (!this.output) return ''
		if (this.output.isError) return failureSummary(this.output)
		return this.presentation.summary(this.output)
	}
}
