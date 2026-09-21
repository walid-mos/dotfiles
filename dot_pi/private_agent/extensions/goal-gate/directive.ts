/**
 * goal-gate - the texts the gate sends into the conversation: the continuation
 * a settled run with open items receives, and the escalation that makes a
 * silent stop visible.
 *
 * Pure text, so the gate's decisions carry no prose and the wording can be
 * asserted on its own. The `goal` tool's own wording (the standing half of the
 * contract) lives in `tool.ts`, next to the schema the model reads it with.
 */

import type { LedgerStatus } from './ledger.ts'

/**
 * The escalation. A run that stops without asking leaves the human unable to
 * tell "unfinished" from "done", and leaves a herdr pane reading idle exactly
 * like a finished one. This message is the gate refusing that: one last turn
 * whose only job is to raise the blocking decision as a real prompt.
 */
export function askText(input: {
	path: string
	reason: string
	status: LedgerStatus
}): string {
	const { path, reason, status } = input
	return [
		`Your run ended with the goal checklist at ${path} still open (${reason}) and asked the human nothing.`,
		'',
		...status.open.map(openItem => `- [ ] ${openItem}`),
		'',
		'Ask with `ask_user_question` only if a consequential human-only decision blocks the work. Put every currently known blocker in one questionnaire instead of drip-feeding later questions; mark the best options recommended. If a defensible default exists, choose it and continue without asking. Never ask whether to continue. Record a real blocker with the `goal` tool (`action: "block"`) and stop.',
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
				'It has no items yet: declare the goal\'s deliverables with the `goal` tool (`action: "declare"`), then work through them.',
			]
	return [
		head,
		'',
		...open,
		'',
		'Continue with the next open item now. Do not ask for permission to continue and do not restate the plan: do the work, close each item with the `goal` tool the moment it lands, and report only once every item is closed or blocked.',
	].join('\n')
}
