// Progress-aware comparison admission; receipts are read from the real branch.
import { loadPixelPair, runPixelDiff } from './pixel-diff.ts'
import { judgePixelProbe } from './pixel-progress-judge.ts'
import {
	pixelIdentity,
	pixelProbeEvidence,
	pixelReceipts,
} from './pixel-progress.ts'

import type {
	PixelJournal,
	PixelProbe,
	PixelReceipt,
} from './pixel-progress.ts'
import type { Config } from './schema.ts'

type Request = { captured_a: string; captured_b: string; probe?: PixelProbe }
type Context = { journal: PixelJournal; redact: (text: string) => string }
export type ProgressResult = {
	text: string
	action: 'compared' | 'reused' | 'held'
}

function held(reason: string, previous: PixelReceipt): ProgressResult {
	return {
		action: 'held',
		text: `BLOCKED: visual investigation needs new evidence. ${reason}\nPrevious result: ${previous.report.split('\n')[0]}\nDo not recapture the same case or repeat this call unchanged. Use a recorded DOM/style/source result to support a falsifiable probe; Cite the Evidence reference from frontend_eval using evidence_entry; no JSON copying is needed. For a long source result, add an exact evidence_quote. Continue independent requested work. No parity or release approval is granted.`,
	}
}

function redactedProbe(
	probe: PixelProbe,
	redact: Context['redact'],
): PixelProbe {
	return {
		...probe,
		hypothesis: redact(probe.hypothesis),
		expected_effect: redact(probe.expected_effect),
		...(probe.evidence_quote && {
			evidence_quote: redact(probe.evidence_quote),
		}),
	}
}

function wasJudged(history: PixelReceipt[], key: string): boolean {
	return history.some(
		receipt =>
			receipt.probeKey === key &&
			(receipt.mode === 'compared' ||
				/^(?:new-information|repetition|cannot-tell);/.test(
					receipt.decision ?? '',
				)),
	)
}

async function judgeSafely(
	...args: Parameters<typeof judgePixelProbe>
): ReturnType<typeof judgePixelProbe> {
	try {
		return await judgePixelProbe(...args)
	} catch (error) {
		return {
			canContinue: false,
			reason: `cannot-tell; Jev request failed (${error instanceof Error ? error.name : 'unknown error'}). No continuation granted; diagnose the service before a new evidence-backed probe.`,
		}
	}
}

function rememberHold(
	journal: PixelJournal,
	history: PixelReceipt[],
	receipt: PixelReceipt,
): void {
	if (
		!history.some(
			prior =>
				prior.probeKey === receipt.probeKey &&
				prior.decision === receipt.decision,
		)
	)
		journal.append(receipt)
}

async function admission(
	options: Request,
	context: Context,
	history: PixelReceipt[],
	identity: { surface: string; pair: string },
): Promise<PixelReceipt | ProgressResult> {
	const previous = history.findLast(receipt => receipt.mode === 'compared')
	const base: PixelReceipt = { ...identity, mode: 'compared', report: '' }
	if (!previous || previous.report.startsWith('PASS:')) return base
	if (!options.probe)
		return held(
			'Supply probe only after collecting relevant diagnostic evidence.',
			previous,
		)
	const evidence = pixelProbeEvidence(
		context.journal.entries(),
		options.probe,
	)
	if (wasJudged(history, evidence.key))
		return held(
			'This hypothesis and supporting evidence were already evaluated; renaming images or rephrasing the quote is not progress.',
			previous,
		)
	const probe = redactedProbe(options.probe, context.redact)
	const decision = await judgeSafely(
		probe,
		{ tool: evidence.tool, quote: context.redact(evidence.quote) },
		history,
	)
	const receipt = {
		...base,
		probe,
		probeKey: evidence.key,
		evidenceHash: evidence.hash,
		decision: decision.reason,
	}
	if (decision.canContinue) return receipt
	rememberHold(context.journal, history, {
		...receipt,
		mode: 'held',
		report: previous.report,
	})
	return held(decision.reason, previous)
}

/** Loads each input once so admission and comparison use exactly the same PNGs. */
export async function runProgressPixelDiff(
	options: Request,
	config: Config,
	context: Context,
	signal?: AbortSignal,
): Promise<ProgressResult> {
	signal?.throwIfAborted()
	const pair = await loadPixelPair(options.captured_a, options.captured_b)
	const identity = pixelIdentity(pair)
	const receipts = pixelReceipts(context.journal.entries())
	const cached = receipts.findLast(
		receipt =>
			receipt.pair === identity.pair && receipt.mode === 'compared',
	)
	if (cached)
		return {
			action: 'reused',
			text: `${cached.report}\nREUSED: identical PNG bytes and metadata; no browser or Jev call. This verdict covers the stored captures, not unobserved current UI. Failed evidence stays failed; investigate before another capture.`,
		}
	const history = receipts.filter(
		receipt => receipt.surface === identity.surface,
	)
	const next = await admission(options, context, history, identity)
	if ('action' in next) return next
	signal?.throwIfAborted()
	const text = await runPixelDiff(pair, config, signal)
	context.journal.append({ ...next, report: context.redact(text) })
	return { action: 'compared', text }
}
