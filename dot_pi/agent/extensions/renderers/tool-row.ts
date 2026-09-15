/** One row's presentation lifecycle. Pi owns execution and expansion; this object owns only timing and details. */
import { Container } from '@earendil-works/pi-tui'

import { renderActivityLine } from '../ui/activity-line.ts'
import { MutationPanel } from '../ui/mutation-panel.ts'

import { ToolChanges } from './tool-changes.ts'
import { ToolDetails } from './tool-details.ts'
import { recalledToolDuration, rememberToolDuration } from './tool-durations.ts'
import { ToolLifecycle } from './tool-lifecycle.ts'
import { failureSummary, isCancelledOutput } from './tool-outcome.ts'
import { toolOutput } from './tool-payload.ts'
import { outputWarning, presentTool } from './tool-presentation.ts'

import type { Theme } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'
import type { ActivityClock } from '../ui/activity-clock.ts'
import type { ActivityLine } from '../ui/activity-line.ts'
import type { RenderContext } from './tool-details.ts'
import type { ToolOutput } from './tool-payload.ts'
import type { ToolPresentation } from './tool-presentation.ts'

export class ToolRow {
	private readonly lifecycle = new ToolLifecycle()
	private readonly details: ToolDetails
	private readonly changes: ToolChanges
	private toolResult: unknown
	private output: ToolOutput | undefined
	private presentation: ToolPresentation
	private summary = ''
	private warning = ''

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

	call(args: unknown, theme: Theme, context: RenderContext): Component {
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
			return new MutationPanel(
				() => this.activityView(context.toolCallId),
				this.showsChanges() ? this.changes : details,
				this.changes.renderFooter() ||
					`click / Ctrl+O to ${context.expanded ? 'fold' : 'expand'}`,
				this.clock.now,
			)
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
		if (phase === 'running') this.clock.watch(this, this.repaint)
		else this.clock.release(this)
		this.summary = this.summarize(phase)
		this.warning = this.output ? outputWarning(this.output) : ''
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
