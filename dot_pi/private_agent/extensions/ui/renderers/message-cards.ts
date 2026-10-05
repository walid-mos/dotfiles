/** Transcript cards for extension custom messages, rendered through
 * `registerMessageRenderer` instead of the default `[customType]` box.
 *
 * `ui/renderers` owns every card whose minter cannot import the house
 * libraries: the vendored frontend package (like its tool-row vocabulary,
 * package-presentations.ts) and the vendored subagents notice family (only
 * subagents' supervisor-request card is registered in-package), plus the
 * messages minted outside the house tree (syneva's pi delivery). The panel
 * itself lives in #lib/ui/message-card.ts; this file decides, per minted
 * type, the family/verb title cues, the status tone and the body policy.
 * All of these minters write the human-readable text themselves, so the
 * cards re-frame it verbatim; an unreadable mint keeps Pi's default box
 * rather than a guess. */
import { NoticeCard, messageBody, recordObject } from '#lib/ui/message-card.ts'

import type {
	ExtensionAPI,
	MessageRenderer,
} from '@earendil-works/pi-coding-agent'
import type { NoticeCardSpec } from '#lib/ui/message-card.ts'

/** The card facts the cue parsers mint before the body joins. */
type PartialNotice = Omit<NoticeCardSpec, 'body'>

const SUBAGENT_FAMILY = 'subagent'

/** Completion/stopped tones read from the minted first line. */
function completionCue(body: string): PartialNotice {
	const first = body.split('\n').at(0) ?? ''
	if (/\bfailed\b|\berror\b/i.test(first))
		return {
			family: SUBAGENT_FAMILY,
			verb: 'failed',
			tone: 'danger',
			cue: 'error',
		}
	if (/stopped|interrupted|paused|timed out/i.test(first))
		return {
			family: SUBAGENT_FAMILY,
			verb: 'stopped',
			tone: 'warning',
			cue: 'cancelled',
		}
	return {
		family: SUBAGENT_FAMILY,
		verb: 'completed',
		tone: 'success',
		cue: 'success',
	}
}

/** Control notices: the wait, the stale child and plain attention. */
function controlCue(
	message: { details?: unknown },
	body: string,
): PartialNotice {
	const event = recordObject(recordObject(message.details)?.event)
	if (event?.type === 'stale' || /\bstale\b/i.test(body))
		return {
			family: SUBAGENT_FAMILY,
			verb: 'stale',
			tone: 'danger',
			cue: 'cancelled',
		}
	if (
		event?.reason === 'supervisor_request' ||
		/supervisor reply/i.test(body)
	)
		return {
			family: SUBAGENT_FAMILY,
			verb: 'wait',
			tone: 'accent',
			cue: 'queued',
		}
	return {
		family: SUBAGENT_FAMILY,
		verb: 'attention',
		tone: 'warning',
		cue: 'attention',
	}
}

const NOTICE_CARDS: ReadonlyArray<{
	type: string
	spec: (message: { details?: unknown }, body: string) => PartialNotice
}> = [
	{
		type: 'subagent-notify',
		spec: (_message, body) => completionCue(body),
	},
	{
		type: 'subagent-incremental-child-notify',
		spec: () => ({
			family: SUBAGENT_FAMILY,
			verb: 'child',
			tone: 'danger',
			cue: 'error',
		}),
	},
	{
		type: 'subagent_control_notice',
		spec: (message, body) => controlCue(message, body),
	},
	{
		type: 'subagent_steering_notice',
		spec: () => ({
			family: SUBAGENT_FAMILY,
			verb: 'steer',
			tone: 'danger',
			cue: 'error',
		}),
	},
	{
		type: 'subagent-slash-result',
		spec: () => ({
			family: SUBAGENT_FAMILY,
			verb: 'result',
			tone: 'accent',
			cue: 'queued',
		}),
	},
	{
		type: 'subagent-slash-text-result',
		spec: () => ({
			family: SUBAGENT_FAMILY,
			verb: 'note',
			tone: 'dim',
			cue: 'queued',
		}),
	},
	{
		type: 'subagents-admin',
		spec: () => ({
			family: SUBAGENT_FAMILY,
			verb: 'status',
			tone: 'dim',
			cue: 'queued',
		}),
	},
	{
		type: 'subagent-wait-subscription',
		spec: () => ({
			family: SUBAGENT_FAMILY,
			verb: 'wait',
			tone: 'dim',
			cue: 'queued',
		}),
	},
	{
		type: 'subagent-workflow-result-write-failed',
		spec: () => ({
			family: SUBAGENT_FAMILY,
			verb: 'persist',
			tone: 'danger',
			cue: 'error',
		}),
	},
	{
		type: 'syneva-event',
		spec: () => ({
			family: 'syneva',
			verb: 'wake',
			tone: 'success',
			cue: 'success',
		}),
	},
]

/** Registers frontend-progress-stop's display; one card per stop message. */
export function registerFrontendStopCard(pi: ExtensionAPI): void {
	registerNoticeCard(pi, 'frontend-progress-stop', message => {
		const body = messageBody(message)
		if (!body) return undefined
		return {
			family: 'frontend',
			verb: 'stop',
			tone: 'warning',
			cue: 'cancelled',
			body,
			footer: 'no pass · no release approval',
		}
	})
}

/** Registers the subagent notice family and the syneva wake, one card each. */
export function registerNoticeCards(pi: ExtensionAPI): void {
	for (const { type, spec } of NOTICE_CARDS)
		registerNoticeCard(pi, type, message => {
			const body = messageBody(message)
			if (!body) return undefined
			return { ...spec(message, body), body }
		})
}

/** One card per message: Pi renders each registered type once. */
function registerNoticeCard(
	pi: ExtensionAPI,
	customType: string,
	view: (message: {
		content: unknown
		details?: unknown
	}) => NoticeCardSpec | undefined,
): void {
	const render: MessageRenderer<unknown> = (message, { expanded }) => {
		const spec = view(message)
		if (!spec) return undefined
		return new NoticeCard(spec, expanded)
	}
	pi.registerMessageRenderer<unknown>(customType, render)
}
