// What a shadowed command's words mean: which files a reader or a search was
// pointed at, which lines a `head` asked for, and the flags that consume a
// value instead of naming one. The verdict reads them ("is this a /tmp log?")
// and so does the refusal's suggestion ("use the `read` tool (path: x)"), so
// the parsing lives once.

/** grep flags whose output no dedicated tool can produce (counts, file lists). */
const GREP_SUMMARY_FLAGS = new Set([
	'-c',
	'--count',
	'-l',
	'--files-with-matches',
	'--files-without-match',
	'-q',
	'--quiet',
	'--silent',
])

/** grep flags that consume the next word (pattern or file list). */
const GREP_VALUE_FLAGS = new Set([
	'-e',
	'--regexp',
	'-f',
	'--file',
	'-m',
	'--max-count',
	'--include',
	'--exclude',
	'--include-dir',
	'--exclude-dir',
])

/** Reader flags that consume the next word: a count, never a path. */
const READER_VALUE_FLAGS = new Set(['-n', '-c', '--lines', '--bytes'])

/** Paths the agent writes throwaway logs to; text there is not project content. */
const TEMP_PATH_PREFIXES = ['/tmp/', '/private/tmp/', '/var/folders/']

/** The search commands whose grep flag vocabulary applies. */
export function isGrepCommand(name: string): boolean {
	return (
		name === 'grep' ||
		name === 'egrep' ||
		name === 'fgrep' ||
		name === 'rg' ||
		name === 'ag' ||
		name === 'ack'
	)
}

/** Count / file-list / quiet flags, including short clusters like `-cE`. */
export function hasSummaryFlag(args: string[]): boolean {
	return args.some(arg => {
		if (!arg.startsWith('--')) return /^-[A-Za-z]*[clq][A-Za-z]*$/.test(arg)
		const [name] = arg.split('=')
		return GREP_SUMMARY_FLAGS.has(name ?? arg)
	})
}

/** The paths of a grep-style command, ignoring flags and the pattern. */
export function grepPaths(args: string[]): string[] {
	const patternIsFlag = args.some(
		arg =>
			arg === '-e' ||
			arg === '--regexp' ||
			arg === '-f' ||
			arg === '--file',
	)
	const paths: string[] = []
	let patternSeen = patternIsFlag
	for (let index = 0; index < args.length; index++) {
		const arg = args[index]
		if (arg === undefined) continue
		const flag = arg.startsWith('-')
		const takesValue =
			!arg.includes('=') && GREP_VALUE_FLAGS.has(arg.split('=')[0] ?? arg)
		if (flag && takesValue) index++
		if (flag) continue
		if (!patternSeen) {
			patternSeen = true
			continue
		}
		paths.push(arg)
	}
	return paths
}

/** The pattern operand of a grep-style command, when it names one outright. */
export function grepPattern(args: string[]): string | undefined {
	const flagIndex = args.findIndex(arg => arg === '-e' || arg === '--regexp')
	if (flagIndex >= 0) return args[flagIndex + 1]
	return args.find(arg => !arg.startsWith('-'))
}

/** The files a reader is handed, whatever count flags surround them. */
export function readerPaths(args: string[]): string[] {
	const paths: string[] = []
	for (let index = 0; index < args.length; index++) {
		const arg = args[index]
		if (arg === undefined) continue
		const flag = arg.startsWith('-')
		const takesValue =
			!arg.includes('=') &&
			READER_VALUE_FLAGS.has(arg.split('=')[0] ?? arg)
		if (flag && takesValue) index++
		if (flag) continue
		paths.push(arg)
	}
	return paths
}

/** The line count of a `head` call: `-n 40`, `-40`, or nothing. */
export function headLimit(args: string[]): string | undefined {
	const nameIndex = args.indexOf('-n')
	if (nameIndex >= 0 && /^\d+$/.test(args[nameIndex + 1] ?? ''))
		return args[nameIndex + 1]
	return args.find(arg => /^-\d+$/.test(arg))?.slice(1)
}

/** True for a path under a throwaway-log directory. */
export function isTempPath(path: string): boolean {
	return TEMP_PATH_PREFIXES.some(prefix => path.startsWith(prefix))
}
