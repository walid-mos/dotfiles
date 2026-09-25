/** The container-config fix: the session model proposes the repo's
 * .pi/container.json from the project facts, code validates it against wt's
 * schema, and the file is written before wt creates the container - so the
 * container is born with the ports, tools and provision the project actually
 * needs. A missing file is generated without asking; an existing file is only
 * replaced with the operator's confirmation, or when wt itself rejected it.
 * wt stays the final judge: a declaration that passes here can still be
 * refused, and the sync flow regenerates on that verdict. */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { uuidv7 } from '@earendil-works/pi-ai'

import { readProjectFacts } from './container-config-facts.ts'
import { SCHEMA_GUIDE, validateDeclaration } from './container-config-schema.ts'

import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { ProjectFacts } from './container-config-facts.ts'

/** A model handle resolved like the registry's own `find` returns. */
type SessionModel = NonNullable<ReturnType<ExtensionContext['modelRegistry']['find']>>

const GENERATION_ATTEMPTS = 2
const GENERATION_MAX_TOKENS = 2_048
const JSON_INDENT_SPACES = 2
const STATUS_KEY = 'container-config'
const WT_INVALID_CONFIG = /invalid container settings/i

export type ConfigFix =
	| {
			kind: 'written'
			summary: string
			/** The replaced content, kept beside the file; null when none existed. */
			backupPath: string | null
	  }
	| { kind: 'kept'; summary: string }
	| { kind: 'failed'; reason: string }

export function configPath(repoRoot: string): string {
	return join(repoRoot, '.pi', 'container.json')
}

/** Generate (and write) the declaration when the repo has none - the silent
 * half of the fix: nothing is replaced, so no confirmation is owed. */
export async function ensureContainerConfig(
	repoRoot: string,
	ctx: ExtensionContext,
): Promise<ConfigFix | null> {
	if (readProjectFacts(repoRoot).current !== null) return null
	return fixContainerConfig(repoRoot, ctx)
}

/** The full fix: generate, then write when the file is missing, wt-rejected
 * (`wtRejected`) or the operator confirms the replacement. */
export async function fixContainerConfig(
	repoRoot: string,
	ctx: ExtensionContext,
	options: { wtRejected?: string | undefined } = {},
): Promise<ConfigFix> {
	const facts = readProjectFacts(repoRoot)
	ctx.ui.setStatus(STATUS_KEY, 'deriving .pi/container.json…')
	try {
		return await deriveAndWrite(repoRoot, ctx, facts, options.wtRejected ?? '')
	} catch (error) {
		return {
			kind: 'failed',
			reason: error instanceof Error ? error.message : String(error),
		}
	} finally {
		ctx.ui.setStatus(STATUS_KEY, undefined)
	}
}

/** The generation attempts: the retry is built from the previous rejection. */
async function deriveAndWrite(
	repoRoot: string,
	ctx: ExtensionContext,
	facts: ProjectFacts,
	initialFeedback: string,
): Promise<ConfigFix> {
	let feedback = initialFeedback
	for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt++) {
		// oxlint-disable-next-line no-await-in-loop -- sequential by contract
		const generation = await generateDeclaration(ctx, facts, feedback)
		if (generation.kind === 'valid') {
			// oxlint-disable-next-line no-await-in-loop -- the write follows the verdict
			return await writeDeclaration(repoRoot, ctx, facts, generation)
		}
		feedback = generation.reason
	}
	return {
		kind: 'failed',
		reason: `the model proposed no schema-valid declaration in ${GENERATION_ATTEMPTS} attempts (last: ${feedback})`,
	}
}

type Generation =
	| { kind: 'valid'; declaration: Record<string, unknown>; summary: string }
	| { kind: 'failed'; reason: string }

async function generateDeclaration(
	ctx: ExtensionContext,
	facts: ProjectFacts,
	feedback: string,
): Promise<Generation> {
	const { model } = ctx
	if (!model) {
		return {
			kind: 'failed',
			reason: 'no model is available to derive the declaration',
		}
	}
	try {
		const reply = await askModel(ctx, model, namingPrompt(facts, feedback))
		const verdict = validateDeclaration(reply)
		return verdict.ok
			? {
					kind: 'valid',
					declaration: verdict.declaration,
					summary: verdict.summary,
				}
			: { kind: 'failed', reason: verdict.reason }
	} catch (error) {
		return {
			kind: 'failed',
			reason: error instanceof Error ? error.message : String(error),
		}
	}
}

function namingPrompt(facts: ProjectFacts, feedback: string): string {
	const defaults = [
		facts.defaults.image ? `image ${facts.defaults.image}` : null,
		facts.defaults.dns ? `dns ${facts.defaults.dns}` : null,
		facts.defaults.cpus ? `${facts.defaults.cpus} cpus` : null,
		facts.defaults.memory ? `memory ${facts.defaults.memory}` : null,
	]
		.filter(Boolean)
		.join(', ')
	const lines = [
		'You write the .pi/container.json declaration for the repository whose facts follow. wt reads this file to build the project container: the image, its size, the ports it publishes, the host services the container must reach and the idempotent provision it runs after the dependency install.',
		'Reply with ONLY the JSON object, nothing else.',
		'Judge from the facts: declare what the project needs, nothing more. A project with no host-side service, no env seeding and no published port needs a small file or none of those keys.',
		`wt defaults this file may override: ${defaults || 'unknown'}. Keys the file omits keep those defaults.`,
		SCHEMA_GUIDE,
		`<project-facts>\n${facts.evidence}\n</project-facts>`,
		facts.current
			? `<current-declaration>\n${facts.current}\n</current-declaration>\nThe repo already declares this; the operator decided to replace it.`
			: 'The repo declares no .pi/container.json yet.',
		feedback ? `Your previous reply was rejected: ${feedback}` : '',
	]
	return lines.filter(line => line.length).join('\n\n')
}

async function askModel(
	ctx: ExtensionContext,
	model: SessionModel,
	prompt: string,
): Promise<string> {
	const completion = await ctx.modelRegistry.complete(
		model,
		{
			messages: [
				{
					role: 'user',
					content: [{ type: 'text', text: prompt }],
					timestamp: Date.now(),
				},
			],
		},
		{
			maxTokens: GENERATION_MAX_TOKENS,
			cacheRetention: 'none',
			sessionId: uuidv7(),
		},
	)
	if (completion.stopReason === 'error') {
		throw new Error(completion.errorMessage ?? 'provider error')
	}
	return completion.content
		.filter(part => part.type === 'text')
		.map(part => part.text ?? '')
		.join('\n')
		.trim()
}

async function writeDeclaration(
	repoRoot: string,
	ctx: ExtensionContext,
	facts: ProjectFacts,
	verdict: { declaration: Record<string, unknown>; summary: string },
): Promise<ConfigFix> {
	const body = `${JSON.stringify(verdict.declaration, null, JSON_INDENT_SPACES)}\n`
	const { current } = facts
	if (current !== null) {
		const agreed = await ctx.ui.confirm(
			'Replace .pi/container.json?',
			`The model derived a new declaration: ${verdict.summary}. The current file is kept as container.json.bak.`,
		)
		if (!agreed) return { kind: 'kept', summary: verdict.summary }
		const backupPath = `${configPath(repoRoot)}.bak`
		writeFileSync(backupPath, current)
		mkdirSync(join(repoRoot, '.pi'), { recursive: true })
		writeFileSync(configPath(repoRoot), body)
		ctx.ui.notify(
			`.pi/container.json replaced: ${verdict.summary}.\n${body}`,
			'info',
		)
		return { kind: 'written', summary: verdict.summary, backupPath }
	}
	mkdirSync(join(repoRoot, '.pi'), { recursive: true })
	writeFileSync(configPath(repoRoot), body)
	ctx.ui.notify(`.pi/container.json created: ${verdict.summary}.\n${body}`, 'info')
	return { kind: 'written', summary: verdict.summary, backupPath: null }
}

/** True when wt's own verdict condemns the declaration, not the machine. */
export function isInvalidConfig(failure: string | null): boolean {
	return failure !== null && WT_INVALID_CONFIG.test(failure)
}
