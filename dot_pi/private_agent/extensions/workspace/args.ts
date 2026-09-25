/** `/workspace` argument parsing: the words before `--` are the work - a literal
 * branch, or free text whose branch name the session model derives (see
 * `name.ts`) - and the words after `--` are the first prompt, verbatim. Without
 * the separator the whole text is both the work and the prompt, plus the
 * optional wt flags. */

export interface WorkspaceArgs {
	/** A literal branch token, or null when the name comes from `deriveBranchName`. */
	branch: string | null
	base: string | null
	shouldCarry: boolean
	shouldFocus: boolean
	prompt: string | null
}

export type ParsedWorkspaceArgs =
	| { ok: true; args: WorkspaceArgs }
	| { ok: false; usage: string }

const USAGE =
	'Usage: /workspace <branch | work to do> [-- base prompt] [--base <ref>] [--carry] [--focus]'

export class UsageError extends Error {}

/** The parse failure contract: a usage line, never a thrown error crossing the caller. */
export function parseWorkspaceArgs(
	tokens: string[],
	knownBranches: string[] = [],
): ParsedWorkspaceArgs {
	try {
		return { ok: true, args: parseArgs(tokens, knownBranches) }
	} catch (error) {
		if (error instanceof UsageError)
			return { ok: false, usage: error.message }
		throw error
	}
}

function parseArgs(tokens: string[], knownBranches: string[]): WorkspaceArgs {
	// The first `--` splits the work from the prompt; flags live with the work.
	const separator = tokens.indexOf('--')
	const hasPromptWords = separator >= 0
	const work = hasPromptWords ? tokens.slice(0, separator) : tokens
	const promptWords = hasPromptWords ? tokens.slice(separator + 1) : null
	const flags = readFlags(work)
	const positionals = wordsOf(work)
	const [first, ...restWords] = positionals
	if (!first) {
		throw new UsageError(`Expected a branch or the work to do. ${USAGE}`)
	}
	// A real branch is a token with a path (`feat/DA-206`) or a bare name wt already
	// knows (`develop`); anything else is free text the session model names from.
	const isLiteralBranch = first.includes('/') || knownBranches.includes(first)
	if (isLiteralBranch) {
		return {
			branch: first,
			prompt: promptText(promptWords, restWords),
			...flags,
		}
	}
	return {
		branch: null,
		prompt: promptText(promptWords, positionals),
		...flags,
	}
}

/** After `--` the prompt is exactly what was typed; without a separator the
 * work's own words (minus the branch token) stay the prompt. */
function promptText(
	promptWords: string[] | null,
	fallback: string[],
): string | null {
	if (promptWords !== null) {
		if (!promptWords.length) return null
		return promptWords.join(' ')
	}
	if (!fallback.length) return null
	return fallback.join(' ')
}

/** The positional words: flags and their values are the caller's business, not words. */
function wordsOf(tokens: string[]): string[] {
	const words: string[] = []
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index]
		if (token === undefined) break
		if (token === '--base') index++
		else if (!token.startsWith('-')) words.push(token)
	}
	return words
}

function readFlags(tokens: string[]): {
	base: string | null
	shouldCarry: boolean
	shouldFocus: boolean
} {
	const flags: {
		base: string | null
		shouldCarry: boolean
		shouldFocus: boolean
	} = {
		base: null,
		shouldCarry: false,
		// Background by default: opening a workspace must never move the user's focus.
		shouldFocus: false,
	}
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index]
		if (token === undefined) break
		if (token === '--base') {
			const applied = applyBase(tokens, index)
			flags.base = applied.value
			index += applied.consumed
		} else if (token === '--carry') {
			flags.shouldCarry = true
		} else if (token === '--focus') {
			flags.shouldFocus = true
		} else if (token.startsWith('-')) {
			throw new UsageError(`Unknown option ${token}. ${USAGE}`)
		}
	}
	return flags
}

function applyBase(
	tokens: string[],
	index: number,
): { value: string; consumed: number } {
	const base = tokens[index + 1]
	if (!base || base.startsWith('-')) {
		throw new UsageError(`--base needs a commit-ish value. ${USAGE}`)
	}
	return { value: base, consumed: 1 }
}

/** Shell-free word split: the prompt is plain text, so whitespace is the only separator. */
export function splitCommandTokens(args: string): string[] {
	const trimmed = args.trim()
	return trimmed.length ? trimmed.split(/\s+/) : []
}
