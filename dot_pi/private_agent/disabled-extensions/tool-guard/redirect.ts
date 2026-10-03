// Translate only standalone commands with a direct dedicated-tool equivalent.
// Everything involving shell composition or an unsupported flag stays blocked.
import { leadingCommand, parseShellText } from './shell-text.ts'

type Redirect = { toolName: string; input: Record<string, unknown> }
const HEAD_SHORT_OPERANDS = 2
const HEAD_LONG_OPERANDS = 3
const FIND_OPERANDS = 3
const MAX_PATH_OPERANDS = 1
const GREP_FLAGS = new Set(['-n', '-i', '-F', '-r', '-R'])

function isStandalone(command: string): boolean {
	const text = parseShellText(command)
	if (/[`$\\\n]/.test(text.raw)) return false
	for (let index = 0; index < text.raw.length; index++) {
		if (text.quoted[index]) continue
		if (/[|;&<>(){}*?#[\]]/.test(text.raw[index] ?? '')) return false
	}
	return true
}

function isPath(path: string | undefined): path is string {
	return (
		!!path && path !== '-' && !path.startsWith('~') && !path.startsWith('-')
	)
}

function headRedirect(args: string[]): Redirect | undefined {
	const [option, operand, last] = args
	const isLong = option === '-n' && args.length === HEAD_LONG_OPERANDS
	const isShort =
		/^-\d+$/.test(option ?? '') && args.length === HEAD_SHORT_OPERANDS
	if (!isLong && !isShort) return undefined
	const count = isLong ? operand : option?.slice(1)
	const path = isLong ? last : operand
	if (!count || !/^\d+$/.test(count) || !isPath(path)) return undefined
	return { toolName: 'read', input: { path, limit: Number(count) } }
}

function readRedirect(name: string, args: string[]): Redirect | undefined {
	if (name === 'head') return headRedirect(args)
	const [path, ...rest] = args
	if (!(name === 'cat' && isPath(path) && !rest.length)) return undefined
	return { toolName: 'read', input: { path } }
}

function grepRedirect(name: string, args: string[]): Redirect | undefined {
	if (name !== 'rg' && name !== 'grep') return undefined
	const flags = args.filter(arg => arg.startsWith('-'))
	if (flags.some(flag => !GREP_FLAGS.has(flag))) return undefined
	const [pattern, path, ...extra] = args.filter(arg => !arg.startsWith('-'))
	if (!pattern || extra.length || (path && !isPath(path))) return undefined
	const isIgnoreCase = flags.includes('-i')
	const isLiteral = flags.includes('-F')
	// grep's basic regex differs from ripgrep's. Plain text is safe as a literal.
	if (name === 'grep' && !isLiteral && !/^[\w /:<>-]+$/.test(pattern))
		return undefined
	const input: Record<string, unknown> = { pattern }
	if (path) input.path = path
	if (isIgnoreCase) input.ignoreCase = true
	if (isLiteral || name === 'grep') input.literal = true
	return { toolName: 'grep', input }
}

function findRedirect(args: string[]): Redirect | undefined {
	const [path, flag, pattern] = args
	if (
		args.length !== FIND_OPERANDS ||
		!isPath(path) ||
		flag !== '-name' ||
		!pattern
	)
		return undefined
	return { toolName: 'find', input: { path, pattern } }
}

function lsRedirect(args: string[]): Redirect | undefined {
	const [path, ...rest] = args
	if (
		args.length > MAX_PATH_OPERANDS ||
		rest.length ||
		(path && !isPath(path))
	)
		return undefined
	const input: Record<string, unknown> = {}
	if (path) input.path = path
	return { toolName: 'ls', input }
}

/** Return a safe, active replacement; never reinterpret a compound shell call. */
export function redirectCommand(
	command: string,
	activeTools: readonly string[],
): Redirect | undefined {
	if (!isStandalone(command)) return undefined
	const { name, args } = leadingCommand(command)
	if (!['cat', 'head', 'ls', 'rg', 'grep', 'find'].includes(name))
		return undefined
	// Wrappers, assignments and altered environments require the real shell.
	if (!command.trimStart().startsWith(`${name} `) && command.trim() !== name)
		return undefined
	let redirect: Redirect | undefined
	if (name === 'ls') redirect = lsRedirect(args)
	else if (name === 'find') redirect = findRedirect(args)
	else redirect = readRedirect(name, args) ?? grepRedirect(name, args)
	if (!(!redirect || !activeTools.includes(redirect.toolName)))
		return redirect
	return undefined
}
