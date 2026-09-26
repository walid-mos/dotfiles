/**
 * Merging what the lenses returned: schema validation, scope filtering,
 * deduplication, risk ordering and the staleness check. The file hashes it
 * compares against are supplied by the caller.
 */

import path from 'node:path'

import { Value } from 'typebox/value'

import { FindingsPayloadSchema } from './lenses.ts'
import { mergeRanges } from './scope-parse.ts'

import type { FindingsPayload } from './lenses.ts'
import type {
	AnalysisOutcome,
	Finding,
	Lens,
	LensFailure,
	LineRange,
	MergedFinding,
	Risk,
	ScopeFile,
	ScopeManifest,
	StaleFinding,
} from './types.ts'

const RISK_ORDER: Record<Risk, number> = { review: 0, confirm: 1, safe: 2 }
const LINE_RANGE = /(\d+)\s*(?:[-\u2013\u2014]\s*(\d+))?/gu
const PARENT_PREFIX = '..'

export interface LensResult {
	lens: Lens
	payload: FindingsPayload
}

export type PayloadParse =
	| { ok: true; payload: FindingsPayload }
	| { ok: false; reason: string }

export function parseLensPayload(lens: Lens, payload: unknown): PayloadParse {
	if (!Value.Check(FindingsPayloadSchema, payload))
		return { ok: false, reason: firstValidationError(payload) }
	if (!(payload.lens !== lens))
		return { ok: true, payload }
	return {
			ok: false,
			reason: `the ${lens} lens reported itself as the ${payload.lens} lens`,
		}
}

function firstValidationError(payload: unknown): string {
	const [first] = Value.Errors(FindingsPayloadSchema, payload)
	if (!first) return 'the payload does not match the findings schema'
	const { instancePath, message } = first
	return instancePath ? `${instancePath}: ${message}` : message
}

export interface MergeInput {
	manifest: ScopeManifest
	lensResults: readonly LensResult[]
	failures: readonly LensFailure[]
}

export function mergeFindings(input: MergeInput): AnalysisOutcome {
	return new MergeRun(input).collect()
}

/** One merge: the findings that survive, the notes that explain the rest. */
class MergeRun {
	private readonly notes: string[] = []
	private readonly merged: MergedFinding[] = []
	private readonly byPath: Map<string, ScopeFile>
	private unparsed = 0

	constructor(private readonly input: MergeInput) {
		this.byPath = new Map(
			input.manifest.files.map(file => [file.path, file]),
		)
	}

	collect(): AnalysisOutcome {
		for (const lensResult of this.input.lensResults)
			this.mergeLens(lensResult)
		if (this.unparsed)
			this.notes.push(
				`${this.unparsed} finding(s) carried no parseable line range: they are still listed, and the applier locates them by their evidence.`,
			)
		return {
			findings: this.ranked(),
			notes: this.notes,
			failures: [...this.input.failures],
		}
	}

	private ranked(): MergedFinding[] {
		return this.merged
			.toSorted(compareFindings)
			.map((finding, index) => withId(finding, index + 1))
	}

	private mergeLens(lensResult: LensResult): void {
		const lensNotes = lensResult.payload.notes?.trim()
		if (lensNotes) this.notes.push(`${lensResult.lens} lens: ${lensNotes}`)
		for (const raw of lensResult.payload.findings)
			this.mergeFinding(lensResult.lens, raw)
	}

	private mergeFinding(lens: Lens, raw: Finding): void {
		const file = normalizePath(raw.file, this.input.manifest.workspaceRoot)
		const scopeFile = this.byPath.get(file)
		if (!scopeFile) {
			this.notes.push(`${raw.file}: ${raw.rootIssue} (outside the scope)`)
			return
		}
		const ranges = parseLines(raw.lines)
		if (!ranges.length) {
			this.unparsed += 1
			this.add({ ...raw, file }, lens, ranges)
			return
		}
		if (inScope(scopeFile.ranges, scopeFile.wholeFile, ranges)) {
			this.add({ ...raw, file }, lens, ranges)
			return
		}
		this.notes.push(
			`${file}:${raw.lines}: ${raw.rootIssue} (outside the changed lines)`,
		)
	}

	private add(
		finding: Finding,
		lens: Lens,
		ranges: readonly LineRange[],
	): void {
		const index = this.merged.findIndex(
			entry => entry.file === finding.file && sameTarget(entry, ranges),
		)
		const existing = this.merged[index]
		if (index === -1 || !existing) {
			this.merged.push({ ...finding, id: 0, lenses: [lens] })
			return
		}
		this.merged[index] = {
			...existing,
			risk: lowerRisk(existing.risk, finding.risk),
			lenses: existing.lenses.includes(lens)
				? existing.lenses
				: [...existing.lenses, lens],
		}
	}
}

function withId(finding: MergedFinding, id: number): MergedFinding {
	return {
		id,
		file: finding.file,
		lines: finding.lines,
		risk: finding.risk,
		action: finding.action,
		title: finding.title,
		rootIssue: finding.rootIssue,
		consequence: finding.consequence,
		benefit: finding.benefit,
		evidence: finding.evidence,
		lenses: finding.lenses,
	}
}

function sameTarget(
	existing: MergedFinding,
	ranges: readonly LineRange[],
): boolean {
	const previous = parseLines(existing.lines)
	// An unparseable range makes the file itself the target.
	if (!previous.length || !ranges.length) return true
	return previous.some(range =>
		ranges.some(other => intersects(range, other)),
	)
}

/** Line ranges of a finding, folded; empty when the text carries none. */
export function parseLines(lines: string): LineRange[] {
	const ranges: LineRange[] = []
	for (const match of lines.matchAll(LINE_RANGE)) {
		const [, startText, endText] = match
		const start = Number(startText ?? '')
		const end = endText ? Number(endText) : start
		if (!Number.isFinite(start) || start <= 0) continue
		ranges.push({
			start,
			end: Number.isFinite(end) ? Math.max(start, end) : start,
		})
	}
	return mergeRanges(ranges)
}

function inScope(
	scopeRanges: readonly LineRange[],
	isWholeFile: boolean,
	ranges: readonly LineRange[],
): boolean {
	if (isWholeFile) return true
	return ranges.some(range =>
		scopeRanges.some(scope => intersects(range, scope)),
	)
}

function intersects(left: LineRange, right: LineRange): boolean {
	return left.start <= right.end && right.start <= left.end
}

/** Highest risk first, then file and position: review, confirm, safe. */
function compareFindings(left: MergedFinding, right: MergedFinding): number {
	const risk = RISK_ORDER[left.risk] - RISK_ORDER[right.risk]
	if (risk) return risk
	if (left.file !== right.file) return left.file < right.file ? -1 : 1
	return firstLine(left) - firstLine(right)
}

function firstLine(finding: MergedFinding): number {
	return parseLines(finding.lines)[0]?.start ?? 0
}

function lowerRisk(left: Risk, right: Risk): Risk {
	return RISK_ORDER[left] <= RISK_ORDER[right] ? left : right
}

function normalizePath(file: string, workspaceRoot: string): string {
	const trimmed = file.trim().replace(/^\.\//u, '')
	if (!path.isAbsolute(trimmed)) return trimmed
	const relative = path.relative(workspaceRoot, trimmed)
	if (!relative || relative.startsWith(PARENT_PREFIX)) return trimmed
	return relative
}

/** Split findings against the current hashes: what still holds, and what moved. */
export function staleSplit(
	findings: readonly MergedFinding[],
	manifest: ScopeManifest,
	currentHashes: ReadonlyMap<string, string>,
): { current: MergedFinding[]; stale: StaleFinding[] } {
	const scopeByPath = new Map(manifest.files.map(file => [file.path, file]))
	const current: MergedFinding[] = []
	const stale: StaleFinding[] = []
	for (const finding of findings) {
		const scopeFile = scopeByPath.get(finding.file)
		if (!scopeFile) {
			stale.push({ finding, reason: 'the file is no longer in scope' })
			continue
		}
		const hash = currentHashes.get(finding.file)
		if (!hash || hash === 'missing') {
			stale.push({ finding, reason: 'the file no longer exists' })
			continue
		}
		if (hash === scopeFile.hash) {
			current.push(finding)
			continue
		}
		stale.push({ finding, reason: 'the file changed since the analysis' })
	}
	return { current, stale }
}

/** One line naming a finding, for notices and the apply message. */
export function describeFinding(finding: MergedFinding): string {
	return `#${finding.id} [${finding.risk}/${finding.action}] ${finding.file}:${finding.lines} - ${finding.rootIssue}`
}
