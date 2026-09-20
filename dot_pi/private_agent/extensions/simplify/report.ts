/**
 * What the run tells the human afterwards: one summary line of counts, then
 * the notes, the stale drops, the skipped files and any lens failure. Notices
 * only - nothing here changes state.
 *
 * The parts travel as the lines of a single notice: pi's notice region keeps
 * only the last notices drawn in one tick, so separate notify() calls lose the
 * summary - the one line worth keeping.
 */

import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type {
	AnalysisOutcome,
	MergedFinding,
	SkippedFile,
	ScopeManifest,
} from './types.ts'

const NOTE_LIMIT = 5

/** What the pipeline reports back, before the manifest is folded in. */
export interface RunTally {
	outcome: AnalysisOutcome
	dispatchedSafe: number
	dispatchedSelected: number
	stale: string[]
	isCheckpointCancelled: boolean
	gateCount: number
}

export interface ReportInput extends RunTally {
	manifest: ScopeManifest
}

/** One notice line, with the severity it would carry on its own. */
interface Notice {
	text: string
	severity: 'info' | 'warning'
}

export function reportRun(ctx: ExtensionContext, input: ReportInput): void {
	const notices = [summaryNotice(input)]
	for (const notice of [
		notesNotice(input),
		staleNotice(input),
		skippedNotice(input),
		gateNotice(input),
	]) {
		if (notice) notices.push(notice)
	}
	ctx.ui.notify(
		notices.map(notice => notice.text).join('\n'),
		notices.some(notice => notice.severity === 'warning')
			? 'warning'
			: 'info',
	)
}

function summaryNotice(input: ReportInput): Notice {
	const counts = [
		`${input.manifest.files.length} file(s) analysed (${input.manifest.label})`,
		`${input.outcome.findings.length} finding(s): ${countByRisk(input.outcome.findings)}`,
	]
	appendOutcomeCounts(counts, input)
	return {
		text: `simplify: ${counts.join(' · ')}.`,
		severity: input.outcome.failures.length ? 'warning' : 'info',
	}
}

function notesNotice(input: ReportInput): Notice | undefined {
	if (!input.outcome.notes.length) return undefined
	return {
		text: `simplify notes: ${bounded(input.outcome.notes)}`,
		severity: 'info',
	}
}

function staleNotice(input: ReportInput): Notice | undefined {
	if (!input.stale.length) return undefined
	return {
		text: `simplify: dropped ${bounded(input.stale)}`,
		severity: 'warning',
	}
}

function skippedNotice(input: ReportInput): Notice | undefined {
	if (!input.manifest.skipped.length) return undefined
	return {
		text: `simplify: skipped ${bounded(input.manifest.skipped.map(describeSkip))}`,
		severity: 'info',
	}
}

function gateNotice(input: ReportInput): Notice | undefined {
	if (input.gateCount) return undefined
	return {
		text: 'simplify: no verification gate was detected in this repository, so the edits were not proven by one.',
		severity: 'warning',
	}
}

function appendOutcomeCounts(counts: string[], input: ReportInput): void {
	if (input.manifest.skipped.length)
		counts.push(`${input.manifest.skipped.length} file(s) skipped`)
	if (input.dispatchedSafe)
		counts.push(
			`${input.dispatchedSafe} safe fix(es) applied automatically`,
		)
	if (input.dispatchedSelected)
		counts.push(
			`${input.dispatchedSelected} finding(s) applied from the checkpoint`,
		)
	if (input.isCheckpointCancelled)
		counts.push(
			'the checkpoint was dismissed, so its findings were not applied',
		)
	if (input.stale.length)
		counts.push(`${input.stale.length} finding(s) dropped as stale`)
	if (!input.outcome.failures.length) return
	counts.push(
		`${input.outcome.failures.length} lens failure(s): ${input.outcome.failures
			.map(failure => `${failure.lens} (${failure.reason})`)
			.join(', ')}`,
	)
}

export function emptyScopeNotice(manifest: ScopeManifest): string {
	const lines = [`simplify: nothing to analyse in ${manifest.label}.`]
	if (manifest.skipped.length)
		lines.push(`Skipped: ${bounded(manifest.skipped.map(describeSkip))}`)
	lines.push('Try /simplify --help for the other scopes.')
	return lines.join('\n')
}

function describeSkip(skip: SkippedFile): string {
	return `${skip.path} (${skip.reason})`
}

function countByRisk(findings: readonly MergedFinding[]): string {
	const counts = { safe: 0, confirm: 0, review: 0 }
	for (const finding of findings) counts[finding.risk] += 1
	return `safe ${counts.safe}, confirm ${counts.confirm}, review ${counts.review}`
}

function bounded(entries: readonly string[]): string {
	const shown = entries.slice(0, NOTE_LIMIT).join('; ')
	if (entries.length <= NOTE_LIMIT) return shown
	return `${shown}; and ${entries.length - NOTE_LIMIT} more`
}
