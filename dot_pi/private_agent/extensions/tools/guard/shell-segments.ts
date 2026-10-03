/** Recognize literal command stages only; unsupported shell syntax stays shell work. */
export type ShellStage = { words: string[]; source: string; after: string }

const TOKEN =
	/[\t \r]*(2>&1(?=[\s|;&]|$)|\|\||&&|[|;\n]|(?:[^\s'"\\|;&<>$`(){}#~*?[\]]+|'[^']*'|"[^"$`\\]*"|\\[^\r\n])+)/gy
const OPERATOR = /^(?:\|\||&&|[|;\n])$/
const WORD_PART = /'([^']*)'|"([^"]*)"|\\(.)|([^'"\\]+)/g
const MAX_SHELL_SOURCE = 16_384
const CD_WORD_COUNT = 2

export function isDirectorySetup(stage: ShellStage): boolean {
	return (
		stage.words[0] === 'cd' &&
		stage.words.length === CD_WORD_COUNT &&
		stage.words[1] !== '-' &&
		stage.after === '&&'
	)
}

function literalWord(source: string): string {
	return [...source.matchAll(WORD_PART)]
		.map(
			([, single, double, escaped, bare]) =>
				single ?? double ?? escaped ?? bare ?? '',
		)
		.join('')
}

export function shellStages(command: string): ShellStage[] {
	if (command.length > MAX_SHELL_SOURCE) return []
	const stages: ShellStage[] = []
	let words: string[] = []
	let start = 0
	let position = 0
	const tokens = new RegExp(TOKEN)
	while (position < command.trimEnd().length) {
		tokens.lastIndex = position
		const token = tokens.exec(command)
		if (!token?.[1]) return []
		const [, text] = token
		position = tokens.lastIndex
		if (!OPERATOR.test(text)) {
			words.push(literalWord(text))
			continue
		}
		if (!words.length) return []
		stages.push({
			words,
			source: command.slice(start, position - text.length).trim(),
			after: text,
		})
		words = []
		start = position
	}
	if (!words.length) return []
	stages.push({ words, source: command.slice(start).trim(), after: '' })
	return stages
}

/** Output-only filters; no file operands, executable sed programs or redirection. */
export function isOutputFilter(stage: ShellStage): boolean {
	const [name, ...args] = stage.words
	if (name === 'head' || name === 'tail')
		return args.every(arg => /^-?(?:\d+|[nqv]+)$/.test(arg))
	if (name !== 'grep' && name !== 'rg') return false
	const operands = args.filter(arg => !arg.startsWith('-'))
	return (
		operands.length === 1 &&
		args.every(arg => !arg.startsWith('-') || /^-[Einivwx]+$/.test(arg))
	)
}

/** Only named package validation tasks; arbitrary scripts are never rewritten. */
export function validationCommand(command: string):
	| {
			base: string
			directory: string
			filters: ShellStage[]
			identity: string
	  }
	| undefined {
	const stages = shellStages(command)
	const [leading] = stages
	const setup =
		leading && isDirectorySetup(leading) ? stages.shift() : undefined
	const first = stages.shift()
	if (
		!first ||
		!/^(?:pnpm|npm|yarn|bun|npx|vitest|tsc|oxlint)$/.test(
			first.words[0] ?? '',
		)
	)
		return undefined
	if (
		!first.words.some(word =>
			/^(?:test(?::[\w-]+)?|vitest|type-?check|lint(?::[\w-]+)?|build|tsc|oxlint)$/.test(
				word,
			),
		)
	)
		return undefined
	if (stages.some(stage => !isOutputFilter(stage))) return undefined
	if ([first, ...stages].slice(0, -1).some(stage => stage.after !== '|'))
		return undefined
	const base = setup ? `${setup.source} && ${first.source}` : first.source
	return {
		base,
		directory: setup?.words[1] ?? '.',
		filters: stages,
		identity: JSON.stringify([setup?.words ?? [], first.words]),
	}
}
