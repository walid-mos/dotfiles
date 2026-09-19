// Shell text: just enough parsing to judge what the host shell will actually
// run. Heredoc bodies are data, quoted spans are strings, and only separators
// outside quotes split a command. No globbing, no substitution, no expansion:
// nothing here needs to execute correctly, it only needs to not lie.

/** Two-character separators (`&&`, `||`) and their width. */
const WIDE_SEPARATORS = new Set(['&&', '||'])
const WIDE_SEPARATOR_WIDTH = 2

/** An escape inside double quotes keeps two characters together. */
const ESCAPE_WIDTH = 2

/** One-character separators that end a command. */
const SEPARATORS = new Set([';', '\n', '&'])

/** Wrappers that do not change which command runs. */
const COMMAND_PREFIXES = new Set([
	'{',
	'do',
	'then',
	'else',
	'time',
	'sudo',
	'command',
	'builtin',
	'nohup',
	'exec',
	'setsid',
	'env',
])

export type ShellText = {
	/** The command with heredoc bodies removed; quotes are kept in place. */
	raw: string
	/** Per character of `raw`: true when it sits inside a quoted span. */
	quoted: boolean[]
}

/** Drop heredoc bodies, then record which characters sit inside quotes. */
export function parseShellText(command: string): ShellText {
	const raw = withoutHeredocBodies(command)
	return { raw, quoted: quoteMask(raw) }
}

/** Everything but the data a heredoc feeds to its command. */
function withoutHeredocBodies(command: string): string {
	const kept: string[] = []
	let terminator: string | null = null
	for (const line of command.split('\n')) {
		if (terminator !== null && endsHeredoc(line, terminator))
			terminator = null
		if (terminator !== null) continue
		kept.push(line)
		terminator = heredocMarker(line)
	}
	return kept.join('\n')
}

/** The nearest heredoc marker opened by `line`, if any. */
function heredocMarker(line: string): string | null {
	const match = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line)
	if (!match) return null
	const [, , marker] = match
	return marker ?? ''
}

/** `<<-` strips leading tabs; every other form needs an exact match. */
function endsHeredoc(line: string, terminator: string): boolean {
	return (
		line.trimEnd() === terminator ||
		line.replace(/^\t+/, '').trimEnd() === terminator
	)
}

/** Mark quoted characters, so later passes ignore words and separators in them. */
function quoteMask(text: string): boolean[] {
	const mask: boolean[] = []
	let quote: string | null = null
	let index = 0
	while (index < text.length) {
		const char = text[index] ?? ''
		if (quote === null && (char === "'" || char === '"')) {
			quote = char
			mask.push(true)
			index++
			continue
		}
		if (char === quote) {
			quote = null
			mask.push(true)
			index++
			continue
		}
		if (quote === '"' && char === '\\') {
			index = skipEscape(text, index, mask)
			continue
		}
		mask.push(quote !== null)
		index++
	}
	return mask
}

/** Mark a backslash escape as quoted; returns the next index to read. */
function skipEscape(text: string, index: number, mask: boolean[]): number {
	mask.push(true)
	const next = index + 1
	if (next >= text.length) return next
	mask.push(true)
	return next + ESCAPE_WIDTH - 1
}

/** The texts the host shell runs, one per command, separators outside quotes. */
export function segments(text: ShellText): string[] {
	const parts: string[] = []
	let current = ''
	let index = 0
	while (index < text.raw.length) {
		const char = text.raw[index] ?? ''
		if (text.quoted[index]) {
			current += char
			index++
			continue
		}
		const pair = text.raw.slice(index, index + WIDE_SEPARATOR_WIDTH)
		let width = 0
		if (WIDE_SEPARATORS.has(pair)) width = WIDE_SEPARATOR_WIDTH
		else if (SEPARATORS.has(char)) width = 1
		if (width > 0) {
			parts.push(current)
			current = ''
			index += width
			continue
		}
		current += char
		index++
	}
	parts.push(current)
	return parts
}

/**
 * The stages of one segment, split on `|` outside quotes. A pipeline hands the
 * same text along, so where a command sits in it never changes what it is.
 */
export function pipeStages(segment: string): string[] {
	const text = parseShellText(segment)
	const stages: string[] = []
	let current = ''
	for (let index = 0; index < text.raw.length; index++) {
		const char = text.raw[index] ?? ''
		if (char === '|' && !text.quoted[index]) {
			stages.push(current)
			current = ''
			continue
		}
		current += char
	}
	stages.push(current)
	return stages
}

/** The executable a segment runs, after env assignments and wrappers. */
export function leadingCommand(segment: string): {
	name: string
	args: string[]
} {
	const words = splitWords(segment.trim().replace(/^[({]+/, ''))
	let index = 0
	while (index < words.length && isWrapper(words[index] ?? '')) index++
	return { name: words[index] ?? '', args: words.slice(index + 1) }
}

function isWrapper(word: string): boolean {
	return COMMAND_PREFIXES.has(word) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)
}

/** Split on whitespace outside quotes; quoted spans keep their content. */
function splitWords(text: string): string[] {
	const words: string[] = []
	let current = ''
	let quote: string | null = null
	for (const char of text) {
		if (quote === null && (char === "'" || char === '"')) {
			quote = char
			continue
		}
		if (char === quote) {
			quote = null
			continue
		}
		if (quote === null && /\s/.test(char)) {
			words.push(...takeWord(current))
			current = ''
			continue
		}
		current += char
	}
	words.push(...takeWord(current))
	return words
}

/** A word list of the accumulated characters, empty when nothing was read. */
function takeWord(word: string): string[] {
	return word ? [word] : []
}
