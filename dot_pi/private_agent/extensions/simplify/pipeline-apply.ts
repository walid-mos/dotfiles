/**
 * The apply stage: the safe findings go in on their own, then the human picks
 * from the checkpoint, and every apply turn ends in the repository's own gates.
 * Hashes are re-read per phase - the safe pass edits files, so the gated
 * findings are checked against the tree as it is after those edits.
 */

import { buildApplyMessage } from './apply.ts'
import { staleSplit } from './findings.ts'
import { hashManifestFiles } from './git-files.ts'
import { showFindingsSelector } from './select-ui.ts'
import { detectGates } from './verify.ts'

import type { RunTally } from './report.ts'
import type { RunDeps } from './run-deps.ts'
import type {
	AnalysisOutcome,
	Gate,
	MergedFinding,
	ScopeManifest,
	StaleFinding,
} from './types.ts'

export type ApplyAttempt =
	| { ok: true; tally: RunTally }
	| { ok: false; notice: string }

export async function applyOutcome(
	deps: RunDeps,
	manifest: ScopeManifest,
	outcome: AnalysisOutcome,
): Promise<ApplyAttempt> {
	const run = new ApplyRun(
		deps,
		manifest,
		await detectGates(manifest.repoRoot),
	)
	const notice = await run.apply(outcome)
	if (notice) return { ok: false, notice }
	return { ok: true, tally: run.tally(outcome) }
}

/** One pass over the findings: safe first, then whatever the human selects. */
class ApplyRun {
	private readonly stale: string[] = []
	private manifest: ScopeManifest
	private dispatchedSafe = 0
	private dispatchedSelected = 0
	private isCheckpointCancelled = false

	constructor(
		private readonly deps: RunDeps,
		manifest: ScopeManifest,
		private readonly gates: readonly Gate[],
	) {
		this.manifest = manifest
	}

	tally(outcome: AnalysisOutcome): RunTally {
		return {
			outcome,
			dispatchedSafe: this.dispatchedSafe,
			dispatchedSelected: this.dispatchedSelected,
			stale: this.stale,
			isCheckpointCancelled: this.isCheckpointCancelled,
			gateCount: this.gates.length,
		}
	}

	/** The notice of a dead apply turn, or undefined when both phases finished. */
	async apply(outcome: AnalysisOutcome): Promise<string | undefined> {
		const safe = outcome.findings.filter(finding => finding.risk === 'safe')
		const safeNotice = await this.applySafe(safe)
		if (safeNotice) return safeNotice
		return await this.applyGated(outcome.findings.filter(isGated))
	}

	private async applySafe(
		safe: readonly MergedFinding[],
	): Promise<string | undefined> {
		if (!safe.length) return undefined
		const current = await this.current(safe)
		if (!current.length) return undefined
		return await this.dispatch(current, 'safe')
	}

	private async applyGated(
		gated: readonly MergedFinding[],
	): Promise<string | undefined> {
		if (!gated.length) return undefined
		const current = await this.current(gated)
		if (!current.length) return undefined
		const choice = await showFindingsSelector(this.deps.ctx, {
			findings: current,
			label: `${this.manifest.label} · ${this.dispatchedSafe} applied automatically`,
		})
		if (!choice) {
			this.isCheckpointCancelled = true
			return undefined
		}
		const selected = current.filter(finding => choice.includes(finding.id))
		if (!selected.length) return undefined
		return await this.dispatch(selected, 'selection')
	}

	private async current(
		findings: readonly MergedFinding[],
	): Promise<MergedFinding[]> {
		const hashes = await hashManifestFiles(
			this.manifest.repoRoot,
			this.manifest.files.map(file => file.path),
		)
		const split = staleSplit(findings, this.manifest, hashes)
		this.stale.push(...split.stale.map(describeStale))
		return split.current
	}

	/**
	 * After an apply turn the baseline moves: the files the applier edited are no
	 * longer "changed since the analysis", so the next phase must not drop their
	 * findings. Anything else that moved under us stays stale.
	 */
	private async rebase(): Promise<void> {
		const hashes = await hashManifestFiles(
			this.manifest.repoRoot,
			this.manifest.files.map(file => file.path),
		)
		this.manifest = {
			...this.manifest,
			files: this.manifest.files.map(file => ({
				...file,
				hash: hashes.get(file.path) ?? 'missing',
			})),
		}
	}

	private async dispatch(
		findings: readonly MergedFinding[],
		phase: 'safe' | 'selection',
	): Promise<string | undefined> {
		this.deps.ctx.ui.setStatus(
			'simplify',
			`applying ${findings.length} ${phase === 'safe' ? 'safe' : 'selected'} fix(es)`,
		)
		const settled = await this.deps.turns.run(() =>
			this.deps.pi.sendUserMessage(
				buildApplyMessage({
					manifest: this.manifest,
					findings,
					gates: this.gates,
					phase,
				}),
			),
		)
		await this.deps.ctx.waitForIdle()
		if (settled === 'timeout')
			return `simplify: the ${phase} apply run never settled. Check the working tree before continuing.`
		await this.rebase()
		if (phase === 'safe') this.dispatchedSafe = findings.length
		else this.dispatchedSelected = findings.length
		return undefined
	}
}

function isGated(finding: MergedFinding): boolean {
	return finding.risk !== 'safe'
}

/** Dropped findings, as notices: the file left the scope or changed under us. */
function describeStale(entry: StaleFinding): string {
	return `#${entry.finding.id} ${entry.reason}`
}
