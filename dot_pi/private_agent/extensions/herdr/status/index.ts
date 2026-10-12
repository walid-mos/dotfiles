import { isBlockedSignal, isBusySignal } from './signals.ts'
import { AGENT_LABEL, HerdrPaneStatusLoop } from './state-loop.ts'

/** herdr/status keeps Herdr's semantic agent state in step with live work.
 * The generated `herdr-agent-state.ts` owns the pane lifecycle, but nothing
 * consumes the subagents package's `herdr:busy` sibling event, so async child
 * work drops the parent to `idle`, and a dropped transition can leave Herdr
 * holding a dead `blocked` after settlement. This extension mirrors the same
 * lifecycle events and atteni signal, merges children work into the parent
 * pane's semantic state, and publishes through its own source
 * (`pi-house-state`), repairing a stale pane via the state-loop reconciliation. */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

const PROMPT_BRIDGE_LABEL = 'Waiting for user input'

function isUnsubscribe(candidate: unknown): candidate is () => void {
	return typeof candidate === 'function'
}

export default function herdrStatus(pi: ExtensionAPI): void {
	const herdrEnv = process.env.HERDR_ENV
	const herdrPaneId = process.env.HERDR_PANE_ID ?? ''
	const herdrCommand = process.env.HERDR_BIN_PATH || 'herdr'
	if (herdrEnv !== '1' || !herdrPaneId.length) return
	const reporter = new HerdrPaneStatusReporter(pi, herdrPaneId, herdrCommand)
	void reporter
}

class HerdrPaneStatusReporter {
	private readonly loop: HerdrPaneStatusLoop
	private isParentBusy = false
	private isChildrenBusy = false
	private hasPendingPrompt = false
	private attentionCount = 0
	private isDisposed = false
	private readonly disposers: Array<() => void> = []

	constructor(pi: ExtensionAPI, paneId: string, herdrCommand: string) {
		this.loop = new HerdrPaneStatusLoop(pi, paneId, herdrCommand, () =>
			this.desiredState(),
		)
		this.wire(pi)
	}

	private desiredState(): string {
		if (this.attentionCount > 0 || this.hasPendingPrompt) return 'blocked'
		if (this.isParentBusy || this.isChildrenBusy) return 'working'
		return 'idle'
	}

	private wire(pi: ExtensionAPI): void {
		this.track(
			pi.on('session_start', (_event, ctx) => {
				this.onSessionStart(ctx)
			}),
		)
		this.track(
			pi.on('agent_start', () => {
				this.onAgentStart()
			}),
		)
		this.track(
			pi.on('agent_settled', (_event, ctx) => {
				this.onAgentSettled(ctx)
			}),
		)
		this.track(
			pi.on('ui_prompt_start', (_event, ctx) => {
				this.onPromptStart(ctx)
			}),
		)
		this.track(
			pi.on('ui_prompt_end', () => {
				this.onPromptEnd()
			}),
		)
		this.track(
			pi.events.on('herdr:blocked', signal => {
				this.onAttentionSignal(signal)
			}),
		)
		this.track(
			pi.events.on('herdr:busy', signal => {
				this.onChildrenSignal(signal)
			}),
		)
		this.track(
			pi.on('session_shutdown', () => {
				this.dispose()
			}),
		)
	}

	private track(candidate: unknown): void {
		if (isUnsubscribe(candidate)) this.disposers.push(candidate)
	}

	private onSessionStart(
		ctx: { mode?: string; isIdle?: () => boolean } | undefined,
	): void {
		if (ctx?.mode !== 'tui') return
		this.isParentBusy = ctx.isIdle?.() === false
		this.isChildrenBusy = false
		this.hasPendingPrompt = false
		this.attentionCount = 0
		this.loop.request()
	}

	private onAgentStart(): void {
		this.isParentBusy = true
		this.loop.cancelRepair()
		this.loop.request()
	}

	private onAgentSettled(ctx: { isIdle?: () => boolean } | undefined): void {
		if (ctx?.isIdle?.() !== true) return
		this.isParentBusy = false
		this.loop.request()
		this.loop.scheduleRepair()
	}

	private onPromptStart(ctx: { mode?: string } | undefined): void {
		if (ctx?.mode !== 'tui' || this.hasPendingPrompt) return
		this.hasPendingPrompt = true
		this.loop.request()
	}

	private onPromptEnd(): void {
		if (!this.hasPendingPrompt) return
		this.hasPendingPrompt = false
		this.loop.request()
	}

	private onAttentionSignal(signal: unknown): void {
		if (!isBlockedSignal(signal) || signal.label === PROMPT_BRIDGE_LABEL) {
			return
		}
		if (!signal.active) {
			this.attentionCount = Math.max(0, this.attentionCount - 1)
			this.loop.request()
			return
		}
		this.attentionCount += 1
		this.loop.request()
	}

	private onChildrenSignal(signal: unknown): void {
		if (!isBusySignal(signal)) return
		const next = signal.active === true
		if (this.isChildrenBusy === next) return
		this.isChildrenBusy = next
		if (next) {
			this.loop.cancelRepair()
		} else {
			this.loop.scheduleRepair()
		}
		this.loop.request()
	}

	private dispose(): void {
		if (this.isDisposed) return
		this.isDisposed = true
		this.loop.dispose()
		for (const off of this.disposers) off()
		this.disposers.length = 0
	}
}

export { AGENT_LABEL }
