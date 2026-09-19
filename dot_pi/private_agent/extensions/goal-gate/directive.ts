/**
 * goal-gate - the texts the agent receives: the standing contract appended to
 * every turn's system prompt, and the continuation sent when a settled run left
 * items open.
 *
 * Pure text, so the gate's decisions carry no prose and the wording can be
 * asserted on its own.
 */

import type { LedgerStatus } from './ledger.ts'

/**
 * Standing contract. It rides the system prompt rather than AGENTS.md because
 * it has to be in context at the exact moment the model decides it is finished,
 * and by that point - late in a long session - a global instruction file is
 * diluted.
 */
export function contractText(path: string): string {
	return [
		'## Goal checklist (goal-gate)',
		'A turn is not the task. Work that has several deliverables is declared before it starts: write the checklist to the path below as `- [ ] item` lines, one per deliverable, and work through every open item in one go.',
		'A tick carries its outcome: when work lands, rewrite the line as `- [x] item - outcome` with what landed and where (commit, file, PR). The ledger is the memory a post-compaction or fresh session re-reads instead of re-deriving the work, so an unticked-without-outcome line is lost work.',
		`Checklist file: ${path}`,
		'Never end a turn to ask whether to continue. If you are genuinely blocked, write `blocked: <reason>` in that file and say what you need.',
	].join('\n')
}

/**
 * The continuation. It is a user message on purpose: it is the same demand the
 * human would have made, sent without them having to repeat it, and it carries
 * the remaining items so the run does not have to re-read the file to know what
 * is left.
 */
export function continueText(input: {
	path: string
	status: LedgerStatus
	attempt: number
}): string {
	const { path, status, attempt } = input
	const head =
		attempt > 1
			? `Your last run ended without closing the goal checklist at ${path} (continuation ${attempt}).`
			: `This run settled with the goal checklist at ${path} still open.`
	const open = status.items.length
		? ['Still open:', ...status.open.map(openItem => `- [ ] ${openItem}`)]
		: [
				'It has no items yet: break the goal into one `- [ ]` line per deliverable, then work through them.',
			]
	return [
		head,
		'',
		...open,
		'',
		'Continue with the next open item now. Do not ask for permission to continue and do not restate the plan: do the work, tick each item in the file as it lands with its outcome on the same line, and report only once every item is closed or blocked.',
	].join('\n')
}
