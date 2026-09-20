/**
 * The /simplify argument grammar, as a pure parser: raw text in, a scope
 * request or a usage answer out. Nothing here reads the repository or the UI.
 */

import type { ScopeMode, ScopeRequest } from './types.ts'

export type CommandArgsOutcome =
	| { kind: 'request'; request: ScopeRequest }
	| { kind: 'help' }
	| { kind: 'error'; message: string }

export const USAGE = `/simplify [scope] [--focus <text>] [paths…]

Analyse the changed code through three fresh-eyes lenses (reuse, quality,
efficiency) and apply only evidence-backed simplifications.

Scope - the default is the working tree against HEAD
  --staged              staged changes only
  --last, --previous    the last commit (HEAD~1..HEAD)
  --ref <ref>           changes against <ref>
  --snapshot <paths…>   whole files, no diff
  --focus <text>        extra emphasis appended to every lens
  --help                this text

Paths narrow the scope to those files (every path for --snapshot).`

const LAST_FLAGS = new Set(['--last', '--last-commit', '--previous', '--prev'])
const VALUE_FLAGS = new Set(['--ref', '--focus'])
const FLAG_PREFIX = '-'
const AFTER_ESCAPE = 2

export function parseCommandArgs(raw: string): CommandArgsOutcome {
	const tokenized = tokenize(raw)
	if ('error' in tokenized) return { kind: 'error', message: tokenized.error }
	return new ArgumentParser().parse(tokenized.tokens)
}

/** Tokenize on whitespace, honouring single and double quotes and escapes. */
export function tokenize(
	raw: string,
): { tokens: string[] } | { error: string } {
	return new Tokenizer().run(raw)
}

/** One command line, character by character. */
class Tokenizer {
	private readonly tokens: string[] = []
	private current = ''
	private quote: "'" | '"' | undefined
	private isStarted = false
	private index = 0

	run(raw: string): { tokens: string[] } | { error: string } {
		while (this.index < raw.length) this.scan(raw)
		if (this.quote)
			return {
				error: `Unterminated ${this.quote === "'" ? 'single' : 'double'} quote.`,
			}
		this.flush()
		return { tokens: this.tokens }
	}

	private scan(raw: string): void {
		if (this.quote) return this.scanQuoted(raw)
		const char = raw[this.index] ?? ''
		const escaped = consumeEscape(raw, this.index)
		if (escaped) return this.push(escaped.text, escaped.next)
		if (char === "'" || char === '"') return this.openQuote(char)
		if (/\s/u.test(char)) return this.flush()
		this.push(char, this.index + 1)
	}

	private scanQuoted(raw: string): void {
		const quote = this.quote ?? '"'
		const char = raw[this.index] ?? ''
		if (char === quote) {
			this.quote = undefined
			this.index += 1
			return
		}
		// Inside single quotes a backslash is literal, like the shell.
		if (quote === '"') {
			const escaped = consumeEscape(raw, this.index)
			if (escaped) return this.push(escaped.text, escaped.next)
		}
		this.push(char, this.index + 1)
	}

	private openQuote(quote: "'" | '"'): void {
		this.quote = quote
		this.isStarted = true
		this.index += 1
	}

	private push(text: string, next: number): void {
		this.current += text
		this.isStarted = true
		this.index = next
	}

	private flush(): void {
		if (!this.isStarted) {
			this.index += 1
			return
		}
		this.tokens.push(this.current)
		this.current = ''
		this.isStarted = false
		this.index += 1
	}
}

/** The character after a backslash, or undefined when this position is not an escape. */
function consumeEscape(
	raw: string,
	index: number,
): { text: string; next: number } | undefined {
	if (raw[index] !== '\\') return undefined
	const next = raw[index + 1]
	if (next === undefined) return undefined
	return { text: next, next: index + AFTER_ESCAPE }
}

function isFlag(token: string): boolean {
	return token.startsWith(FLAG_PREFIX) && token.length > FLAG_PREFIX.length
}

type Flag = { name: string; value: string; hasInlineValue: boolean }

function splitFlag(token: string): Flag {
	const separator = token.indexOf('=')
	if (separator === -1)
		return { name: token, value: '', hasInlineValue: false }
	return {
		name: token.slice(0, separator),
		value: token.slice(separator + 1),
		hasInlineValue: true,
	}
}

/** Collects the flags and positionals of one command line. */
class ArgumentParser {
	private tokens: readonly string[] = []
	private index = 0
	private mode: ScopeMode | undefined
	private modeFlag = 'a scope flag'
	private focus = ''
	private isSnapshot = false
	private isLiteral = false
	private isHelp = false
	private failure = ''
	private readonly positionals: string[] = []

	parse(tokens: readonly string[]): CommandArgsOutcome {
		this.tokens = tokens
		while (this.index < this.tokens.length && !this.failure) this.step()
		if (this.failure) return { kind: 'error', message: this.failure }
		if (this.isHelp) return { kind: 'help' }
		return this.request()
	}

	private step(): void {
		const token = this.tokens[this.index] ?? ''
		this.index += 1
		if (this.isLiteral) return this.take(token)
		if (token === '--') {
			this.isLiteral = true
			return
		}
		if (token === '--help' || token === '-h') {
			this.isHelp = true
			return
		}
		if (!isFlag(token)) return this.take(token)
		this.flag(splitFlag(token))
	}

	private take(token: string): void {
		this.positionals.push(token)
	}

	private flag(flag: Flag): void {
		const { name } = flag
		if (flag.hasInlineValue && !VALUE_FLAGS.has(name))
			return this.fail(`${name} does not take a value.`)
		if (LAST_FLAGS.has(name)) return this.setMode({ kind: 'last' }, name)
		switch (name) {
			case '--staged':
				return this.setMode({ kind: 'staged' }, name)
			case '--snapshot':
				return this.snapshot(name)
			case '--ref':
				return this.ref(flag)
			case '--focus':
				return this.focusFlag(flag)
			default:
				return this.fail(
					`Unknown option ${name}. Run /simplify --help.`,
				)
		}
	}

	private snapshot(name: string): void {
		this.isSnapshot = true
		this.setMode({ kind: 'snapshot', paths: [] }, name)
	}

	private ref(flag: Flag): void {
		const ref = this.flagValue(flag)
		if (ref) this.setMode({ kind: 'ref', ref }, flag.name)
	}

	private focusFlag(flag: Flag): void {
		const text = this.flagValue(flag)
		if (text) this.focus = text
	}

	/** The flag's value: an inline one, or the next token as the shell reads it. */
	private flagValue(flag: Flag): string | undefined {
		const text = flag.hasInlineValue
			? flag.value
			: (this.tokens[this.index] ?? '')
		if (!flag.hasInlineValue) this.index += 1
		const named = text.trim()
		if (!named || named.startsWith(FLAG_PREFIX))
			return this.failed(`${flag.name} needs a value.`)
		if (flag.name === '--ref' && named.includes('..'))
			return this.failed(
				`${named} is a revision expression; name a single ref (for example main).`,
			)
		return named
	}

	private setMode(mode: ScopeMode, flag: string): void {
		if (this.mode)
			return this.fail(
				`${this.modeFlag} already sets the scope, so ${flag} conflicts with it.`,
			)
		this.mode = mode
		this.modeFlag = flag
	}

	private fail(message: string): void {
		this.failure = message
	}

	private failed(message: string): undefined {
		this.failure = message
		return undefined
	}

	private request(): CommandArgsOutcome {
		if (!this.isSnapshot)
			return {
				kind: 'request',
				request: this.withFocus({
					mode: this.mode ?? { kind: 'worktree' },
					paths: this.positionals,
				}),
			}
		const paths = unique(this.positionals)
		if (!paths.length)
			return {
				kind: 'error',
				message: '--snapshot needs at least one path.',
			}
		return {
			kind: 'request',
			request: this.withFocus({
				mode: { kind: 'snapshot', paths },
				paths: [],
			}),
		}
	}

	private withFocus(request: ScopeRequest): ScopeRequest {
		if (!this.focus) return request
		return { ...request, focus: this.focus }
	}
}

function unique(entries: readonly string[]): string[] {
	const seen = new Set<string>()
	const kept: string[] = []
	for (const entry of entries) {
		if (seen.has(entry)) continue
		seen.add(entry)
		kept.push(entry)
	}
	return kept
}
