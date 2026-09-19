// The call the refused work should have been: what the model needs at the
// moment it retries, read off the shadower's own operands, instead of a
// catalogue of the bash forms that stay legal. `ls ops` suggests
// ``use the `ls` tool (path: `ops`)``; `head -40 package.json` suggests
// ``use the `read` tool (path: `package.json`, limit: 40)``.

import {
	grepPaths,
	grepPattern,
	headLimit,
	readerPaths,
} from './stage-arguments.ts'

/** The parenthesised arguments of a dedicated tool call, empty when unknown. */
export function suggestedCall(
	tool: string,
	name: string,
	args: string[],
): string {
	const hints = argumentHints(tool, name, args)
	return hints.length ? ` (${hints.join(', ')})` : ''
}

/** Tool arguments the shadowed stage already carries: path, pattern, limit. */
function argumentHints(tool: string, name: string, args: string[]): string[] {
	if (tool === 'grep') {
		const pattern = grepPattern(args)
		const [path] = grepPaths(args)
		return [
			...(pattern ? [`pattern: \`${pattern}\``] : []),
			...(path ? [`path: \`${path}\``] : []),
		]
	}
	if (tool === 'find') return findHints(name, args)
	const [path] = readerPaths(args)
	const limit = name === 'head' ? headLimit(args) : undefined
	return [
		...(path ? [`path: \`${path}\``] : []),
		...(limit ? [`limit: ${limit}`] : []),
	]
}

/** Where a `find` or `tree` call pointed: the path, and the name it matched. */
function findHints(name: string, args: string[]): string[] {
	if (name === 'tree') {
		const [path] = readerPaths(args)
		return path ? [`path: \`${path}\``] : []
	}
	const path = args.find(arg => !arg.startsWith('-'))
	const nameIndex = args.findIndex(arg => arg === '-name' || arg === '-iname')
	const pattern = nameIndex >= 0 ? args[nameIndex + 1] : undefined
	return [
		...(path ? [`path: \`${path}\``] : []),
		...(pattern ? [`pattern: \`${pattern}\``] : []),
	]
}
