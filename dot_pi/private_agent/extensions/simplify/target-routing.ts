/** Route a bare /simplify target: literal file areas stay deterministic; requests need an agent. */

import { askChoice, isJevConfigured } from '../jev/client.ts'

import type { ChoiceQuestion } from '../jev/client.ts'

const ROUTING_TIMEOUT_MS = 4_000
const SIMPLE_CONFIDENCE = 0.65

const TARGET_QUESTION: ChoiceQuestion = {
	instructions:
		'Choose how to handle the entire /simplify target, in any language. A literal file or directory name can be resolved without interpretation. A request describing only part of a branch or diff, multiple targets, PRs, or an action such as committing needs an agent to discover the scope and obey the directive. Judge the meaning, not whether the text happens to contain a slash or a filename.',
	criteria: {
		simple: 'Exactly one literal file or directory in the current workspace, with no workflow directive or semantic restriction on which changed lines to include (for example "backend" or "src/api").',
		agent: 'A semantic or compound request: part of a branch, a feature, a subset of a diff, multiple files/branches/PRs, or instructions for what to do with the result (for example "the backend changes on this branch" or "PR #251 and #252, commit each").',
	},
}

/** Uncertain or unavailable classification goes to the agent, never to a false path match. */
export async function routeTarget(query: string): Promise<'simple' | 'agent'> {
	if (!isJevConfigured()) return 'agent'
	try {
		const decision = await askChoice({ target: query }, TARGET_QUESTION, {
			timeoutMs: ROUTING_TIMEOUT_MS,
		})
		return decision.choice === 'simple' &&
			decision.confidence >= SIMPLE_CONFIDENCE
			? 'simple'
			: 'agent'
	} catch {
		return 'agent'
	}
}
