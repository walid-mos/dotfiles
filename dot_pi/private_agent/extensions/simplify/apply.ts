/**
 * The messages that hand work to the model: apply these findings, then prove
 * the change. Both are contracts - the applier may change how code reads,
 * never what it does, and it reports what it skipped and why.
 */

import { describeFinding } from './findings.ts'

import type {
	FindingAction,
	Gate,
	MergedFinding,
	ScopeManifest,
} from './types.ts'

const ACTION_INSTRUCTION: Record<FindingAction, string> = {
	delete: 'Delete exactly the code named above. Search the whole repository first (calls, imports, string and reflection lookups, config, entry points, tests) and stop if any live reference exists.',
	inline: 'Replace the wrapper with the work it forwards to and update its call sites. Do not inline anything that a public API or an unstable dependency depends on.',
	refactor:
		'Make the change named above, and nothing beyond it. Keep the surrounding code, formatting and comments as they are.',
	parallelize:
		'Reorder the work so it happens once (or independently) instead of repeatedly. The observable result, ordering of side effects and error behaviour must not change.',
	rename: 'Rename only what is named above, everywhere it is used. Do not take the opportunity to change anything else.',
}

export interface ApplyInput {
	manifest: ScopeManifest
	findings: readonly MergedFinding[]
	gates: readonly Gate[]
	phase: 'safe' | 'selection'
}

export function buildApplyMessage(input: ApplyInput): string {
	const files = [
		...new Set(input.findings.map(finding => finding.file)),
	].toSorted()
	return lines([
		`## /simplify - apply ${input.findings.length} finding(s)`,
		'',
		`Scope: ${input.manifest.label} in ${input.manifest.repoRoot}`,
		`Files involved: ${files.join(', ')}`,
		'',
		'### Findings',
		'',
		...input.findings.flatMap(finding => findingBlock(finding)),
		'### Contract',
		'',
		'- Behaviour preservation is absolute: no change to outputs, return values, error behaviour, ordering, side effects or resource ownership.',
		'- The line numbers above are hints. Locate each finding by the quoted evidence and the current file contents. If the evidence is no longer there, skip that finding and say so - never guess at what it meant.',
		'- Touch only the files listed above. Do not reformat, do not fix anything not listed, do not add tests, comments or abstractions, and do not commit or stage anything.',
		'- Follow the repository conventions the code already shows. If a finding contradicts a project rule or a loaded skill, skip it and report the conflict.',
		'',
		'### Verification',
		'',
		...verificationBlock(input),
		'',
		'### Report',
		'',
		'- One line per finding: `applied` or `skipped: <reason>`.',
		'- The exact commands you ran and their results, in order.',
		'- The output of `git diff --stat` for the files above.',
		`- The revert command for these files: \`git -C ${input.manifest.repoRoot} restore -- ${files.join(' ')}\`.`,
	])
}

function findingBlock(finding: MergedFinding): string[] {
	return [
		`#### ${describeFinding(finding)}`,
		'',
		`- Lenses: ${finding.lenses.join(', ')}`,
		`- Issue: ${finding.rootIssue}`,
		`- Cost if left: ${finding.consequence}`,
		`- Gain: ${finding.benefit}`,
		`- Evidence: ${finding.evidence}`,
		`- Do: ${ACTION_INSTRUCTION[finding.action]}`,
		'',
	]
}

function verificationBlock(input: ApplyInput): string[] {
	const cheap = input.gates.filter(gate => !gate.long)
	const long = input.gates.filter(gate => gate.long)
	const block: string[] = []
	if (!input.gates.length) {
		block.push(
			'No gate was detected in this repository. Run the checks this project actually has, or state plainly that none could be run.',
		)
		return block
	}
	block.push(
		`Run these from ${input.manifest.repoRoot} with your own shell tool, in this order, and report each command with its result:`,
	)
	for (const gate of cheap)
		block.push(`- \`${gate.command}\` (${gate.label})`)
	for (const gate of long)
		block.push(
			`Ask the user before running \`${gate.command}\` (${gate.label}): it is a long suite. If they decline, say it was left unrun.`,
		)
	block.push(
		'If a gate fails, fix only what these edits broke. If it is not yours to fix, revert that one finding and report it - do not paper over a failure.',
	)
	return block
}

function lines(entries: readonly string[]): string {
	return entries.join('\n')
}
