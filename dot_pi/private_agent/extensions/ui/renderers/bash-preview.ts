/** Conservative display-only shell preview. Never evaluate or rewrite the executed command. */
import { basename } from 'node:path'

import { singleLine } from './tool-payload.ts'

interface BashPreview {
	subject: string
	annotation: string
}

// Recognize simple literal cd setup only; uncertain shell syntax stays verbatim.
const DIRECTORY_SETUP =
	/^cd[\t ]+(?:--[\t ]+)?(?<directory>"[^"$`\\\r\n]+"|'[^'\r\n]+'|[\p{L}\p{N}_./:+,@%=-]+)[\t ]*(?:&&|;|\r?\n)[\t ]*/u
const STAGE_ENDS = new Set([';', '<', '>', '&&', '||', '&>'])
const QUOTES = new Set(['"', "'"])
const OPERATOR_COLUMNS = 2

function scriptSource(command: string): string {
	const lines = command.trim().split(/\r?\n/u)
	const first = lines.findIndex(
		line => line.trim() && !line.trimStart().startsWith('#'),
	)
	return lines.slice(Math.max(0, first)).join('\n').trim()
}

function stagePrefix(line: string, index: number): string {
	const prefix = line.slice(0, index)
	const head =
		line[index] === '<' || line[index] === '>'
			? prefix.replace(/(?:^|[\t ]+)\d+$/u, '')
			: prefix
	return head.trimEnd()
}

function firstStage(line: string): string {
	// A source prefix is safer than pretending to parse nested substitutions.
	if (line.includes('$(') || line.includes('`')) return line
	let quote = ''
	let isEscaped = false
	for (let index = 0; index < line.length; index++) {
		const character = line[index] ?? ''
		if (isEscaped) {
			isEscaped = false
			continue
		}
		if (character === '\\' && quote !== "'") {
			isEscaped = true
			continue
		}
		if (quote) {
			quote = character === quote ? '' : quote
			continue
		}
		if (QUOTES.has(character)) {
			quote = character
			continue
		}
		const operator = line.slice(index, index + OPERATOR_COLUMNS)
		if (STAGE_ENDS.has(character) || STAGE_ENDS.has(operator))
			return stagePrefix(line, index)
	}
	return line
}

function directoryAnnotation(token: string): string {
	if (!token) return ''
	const path = QUOTES.has(token[0] ?? '') ? token.slice(1, -1) : token
	return `cd ${basename(path) || path}`
}

export function bashPreview(command: string): BashPreview {
	const source = scriptSource(command)
	const setup = DIRECTORY_SETUP.exec(source)
	const remainder = setup ? source.slice(setup[0].length).trimStart() : ''
	const directory = remainder ? (setup?.groups?.directory ?? '') : ''
	const body = remainder || source
	const line = body.split('\n', 1)[0] ?? ''
	const head = firstStage(line).trim() || line.trim()
	const suffix = head === source ? '' : ' …'
	return {
		subject: singleLine(head) + suffix,
		annotation: directoryAnnotation(directory),
	}
}
