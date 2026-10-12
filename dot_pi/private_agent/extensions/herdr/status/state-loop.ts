import { herdrPaneStatusFrom } from './signals.ts'

/** Herdr status loop: ordered send queue, sequence stamps, and the
 * post-settle reconcile that repairs a stale pane state against Herdr's own
 * answer (Herdr resolves pane state by latest accepted report). */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

const SOURCE = 'pi-house-state'
export const AGENT_LABEL = 'pi'
const SEND_TIMEOUT_MS = 5000
const RECONCILE_DELAY_MS = 1500
const SEQ_UNIT_MS = 1000

export class HerdrPaneStatusLoop {
	private readonly pi: ExtensionAPI
	private readonly paneId: string
	private readonly herdrCommand: string
	private readonly desiredProvider: () => string
	private lastSent: string | undefined
	private reportedSeq = Date.now() * SEQ_UNIT_MS
	private isDisposed = false
	private isSending = false
	private readonly pendingStates: string[] = []
	private repairTimer: ReturnType<typeof setTimeout> | undefined

	constructor(
		pi: ExtensionAPI,
		paneId: string,
		herdrCommand: string,
		desiredProvider: () => string,
	) {
		this.pi = pi
		this.paneId = paneId
		this.herdrCommand = herdrCommand
		this.desiredProvider = desiredProvider
	}

	request(): void {
		this.push(this.desiredProvider(), false)
	}

	requestWhenHerdrHoldsStaleState(): void {
		this.lastSent = undefined
		this.push('idle', true)
	}

	async repair(): Promise<void> {
		if (this.desiredProvider() !== 'idle') return
		const reported = await this.readHerdrStatus()
		if (this.desiredProvider() !== 'idle') return
		if (!reported || reported === 'done') return
		this.requestWhenHerdrHoldsStaleState()
	}

	scheduleRepair(): void {
		clearTimeout(this.repairTimer)
		this.repairTimer = setTimeout(() => {
			void this.repair()
		}, RECONCILE_DELAY_MS)
		this.repairTimer.unref?.()
	}

	cancelRepair(): void {
		clearTimeout(this.repairTimer)
		this.repairTimer = undefined
	}

	dispose(): void {
		if (this.isDisposed) return
		this.isDisposed = true
		this.cancelRepair()
	}

	private push(state: string, isForced: boolean): void {
		if (this.isDisposed) return
		if (!isForced && state === this.lastSent) return
		this.lastSent = state
		this.pendingStates.push(state)
		this.scheduleSend()
	}

	private scheduleSend(): void {
		if (this.isSending || !this.pendingStates.length || this.isDisposed) {
			return
		}
		this.isSending = true
		void this.sendNext()
	}

	private async sendNext(): Promise<void> {
		const state = this.pendingStates.shift()
		if (!state) {
			this.isSending = false
			return
		}
		await this.sendState(state)
		this.isSending = false
		this.scheduleSend()
	}

	private async sendState(state: string): Promise<void> {
		try {
			await this.pi.exec(
				this.herdrCommand,
				[
					'pane',
					'report-agent',
					this.paneId,
					'--source',
					SOURCE,
					'--agent',
					AGENT_LABEL,
					'--state',
					state,
					'--seq',
					String(this.nextReportSeq()),
				],
				{ timeout: SEND_TIMEOUT_MS },
			)
		} catch {
			// Delivery is best effort; the next transition or repair fixes Herdr.
		}
	}

	private nextReportSeq(): number {
		this.reportedSeq = Math.max(
			this.reportedSeq + 1,
			Date.now() * SEQ_UNIT_MS,
		)
		return this.reportedSeq
	}

	private async readHerdrStatus(): Promise<string | undefined> {
		try {
			const herdrOutput = await this.pi.exec(
				this.herdrCommand,
				['agent', 'list'],
				{ timeout: SEND_TIMEOUT_MS },
			)
			return herdrPaneStatusFrom(herdrOutput.stdout, this.paneId)
		} catch {
			return undefined
		}
	}
}
