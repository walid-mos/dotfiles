/** Branch naming: the session model proposes candidate names, Jev (when
 * configured) picks the one that best names the work. Every reply line is
 * sanitized - accents, casing, list markers, markdown - before extraction, and
 * a reply with no structural candidate is slugified whole, so the model's own
 * naming almost always lands; the command fails only when the reply holds
 * nothing name-like at all. */

import { uuidv7 } from '@earendil-works/pi-ai'

import { askChoice, isJevConfigured } from '../jev/client.ts'

import type { ExtensionContext } from '@earendil-works/pi-coding-agent'

/** A model handle resolved like the registry's own `find` returns. */
type SessionModel = NonNullable<
	ReturnType<ExtensionContext['modelRegistry']['find']>
>

type NamingPrompt = {
	intent: string
	conventions: string[]
	feedback: string
}

const MAX_BRANCH_CHARS = 64
/** Room for a reasoning model to think before it names: too small and the
 * naming reply comes back empty on every attempt. */
const NAMING_MAX_TOKENS = 512
const NAMING_ATTEMPTS = 2

/** The branch families the naming prompt offers; validation stays structural. */
const BRANCH_TYPES = [
	'feat',
	'fix',
	'chore',
	'refactor',
	'perf',
	'docs',
	'test',
	'style',
	'hotfix',
	'release',
	'bugfix',
]

/** Name the work: the session model proposes, Jev refines, code sanitizes. */
export async function deriveBranchName(
	intent: string,
	conventions: string[],
	ctx: ExtensionContext,
): Promise<string> {
	const { model } = ctx
	if (!model) {
		throw new Error(
			'No model is available to name the branch; use /workspace <branch>.',
		)
	}
	let feedback = ''
	for (let attempt = 0; attempt < NAMING_ATTEMPTS; attempt++) {
		// Sequential by contract: the retry is built from the previous answer's failure.
		// oxlint-disable-next-line no-await-in-loop
		const candidates = await proposeCandidates(ctx, model, {
			intent,
			conventions,
			feedback,
		})
		if (candidates.length) return selectCandidate(intent, candidates)
		feedback = 'Your previous reply contained no usable candidate name.'
	}
	throw new Error(
		`The model proposed no usable branch name for "${intent}"; use /workspace <branch> to name it yourself.`,
	)
}

type AssistantText = { type: string; text?: string }

async function proposeCandidates(
	ctx: ExtensionContext,
	model: SessionModel,
	request: NamingPrompt,
): Promise<string[]> {
	const completion = await ctx.modelRegistry.complete(
		model,
		{ messages: [namingRequest(request)] },
		{
			maxTokens: NAMING_MAX_TOKENS,
			cacheRetention: 'none',
			sessionId: uuidv7(),
		},
	)
	if (completion.stopReason === 'error') {
		throw new Error(completion.errorMessage ?? 'provider error')
	}
	return candidatesFromReply(replyText(completion.content))
}

function namingRequest(request: NamingPrompt): {
	role: 'user'
	content: { type: 'text'; text: string }[]
	timestamp: number
} {
	const { intent, conventions, feedback } = request
	const lines = [
		'You name a git branch for work a user described. Reply with exactly three candidate names, one per line, nothing else.',
		`Each candidate: a family prefix from ${BRANCH_TYPES.join('|')} followed by "/", then a slug of lowercase latin letters, digits, "." and "-", words joined by single "-". At most ${MAX_BRANCH_CHARS} characters.`,
		'The slug must name the work precisely and concisely; copying the sentence word for word is wrong.',
		conventions.length
			? `Recent branches of this repository, for its conventions:\n${conventions.join('\n')}`
			: 'This repository has no recorded branch conventions.',
		`Work to name: ${intent}`,
		feedback,
	]
	return {
		role: 'user',
		content: [
			{
				type: 'text',
				text: lines.filter(part => part.length).join('\n\n'),
			},
		],
		timestamp: Date.now(),
	}
}

/** Fold one reply line: strip list markers and markdown, then accents and casing. */
function normalizeLine(line: string): string {
	return line
		.trim()
		.replace(/^[*•-]+\s*/, '')
		.replace(/^\d+[.)]\s*/, '')
		.replace(/[`*]/g, '')
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
}

/** Reduce a folded line to slug charset, then trim the edges clean. */
function slugify(text: string): string {
	return text
		.replace(/[^a-z0-9._/-]+/g, '-')
		.replace(/^[-._/]+|[-._/]+$/g, '')
}

/** Candidate from a well-formed line: an explicit prefix/slug, or a bare slug
 * standing alone; anything wordier is left to the reply-level rescue. */
function structuralCandidate(line: string): string | null {
	const normalized = normalizeLine(line)
	const prefixed = /([a-z]{2,}\/[a-z0-9][a-z0-9._-]*)/.exec(normalized)
	if (prefixed?.[1]) return capCandidate(prefixed[1])
	if (!/^[a-z0-9._-]+$/.test(normalized)) return null
	return capCandidate(normalized)
}

/** Keep a candidate under the cap; a trimmed trailing separator stays clean. */
function capCandidate(candidate: string): string {
	return candidate.slice(0, MAX_BRANCH_CHARS).replace(/[-._]+$/, '')
}

/** Extract candidates from a full reply. Wordy lines are ignored while any
 * structural candidate exists; a reply with none is slugified whole, so the
 * model's naming still lands instead of failing the command. */
export function candidatesFromReply(text: string): string[] {
	const seen = new Set<string>()
	for (const line of text.split('\n')) {
		const candidate = structuralCandidate(line)
		if (candidate) seen.add(candidate)
	}
	if (seen.size === 0) {
		const rescued = capCandidate(slugify(normalizeLine(text)))
		if (rescued) seen.add(rescued)
	}
	return [...seen]
}

function replyText(content: AssistantText[]): string {
	return content
		.filter(part => part.type === 'text')
		.map(part => part.text ?? '')
		.join('\n')
		.trim()
}

/** Jev picks among the candidates when it is configured; its own failure or
 * absence leaves the choice to the session model's first candidate. */
async function selectCandidate(
	intent: string,
	candidates: string[],
): Promise<string> {
	const [first] = candidates
	if (!first) throw new Error('no branch name candidate')
	if (candidates.length === 1) return first
	if (!isJevConfigured()) return first
	try {
		const decision = await askChoice(
			{ intent, candidates },
			{
				instructions:
					'Which of these git branch names best names the work in `intent`? A sharp, short name beats a word-for-word copy of the sentence; judge precision and the repository conventions implied by the shapes of the candidates.',
				criteria: Object.fromEntries(
					candidates.map((name, index) => [
						String(index),
						`branch name: ${name}`,
					]),
				),
			},
		)
		const picked = candidates[Number(decision.choice)]
		return picked ?? first
	} catch {
		return first
	}
}
