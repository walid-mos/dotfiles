/** Tool-specific vocabulary for Pi's own tools. New tools inherit the default presentation, which
reads the tool's own name and first string argument instead of Pi's raw snake_case title.
Package tools register their vocabulary in `package-presentations.ts`. */
import { homedir } from 'node:os'
import { basename, dirname, sep } from 'node:path'

import { reflectMember } from '../ui/pi-members.ts'

import { bashPreview } from './bash-preview.ts'
import { PACKAGE_PRESENTATIONS } from './package-presentations.ts'
import {
	count,
	countLines,
	outputLineCount,
	payloadNumber,
	payloadText,
	singleLine,
} from './tool-payload.ts'

import type { ToolOutput } from './tool-payload.ts'

export interface ToolPresentation {
	label: string
	subject: string
	annotation: string
	timeoutSeconds?: number | undefined
	summary(output: ToolOutput): string
	body: 'text' | 'native'
}

type PresentTool = (args: unknown) => ToolPresentation

function parentDirectory(path: string): string {
	if (!path) return ''
	const directory = dirname(path)
	if (directory === '.' || directory === path) return ''
	const home = homedir()
	if (directory === home) return '~'
	return directory.startsWith(home + sep)
		? `~${directory.slice(home.length)}`
		: directory
}

function readPresentation(args: unknown): ToolPresentation {
	const path = payloadText(args, 'path')
	const offset = payloadNumber(args, 'offset') ?? 1
	const limit = payloadNumber(args, 'limit')
	const hasRange = offset !== 1 || typeof limit === 'number'
	const range = hasRange
		? `L${String(offset)}-${typeof limit === 'number' ? String(offset + limit - 1) : 'end'}`
		: ''
	return {
		label: 'read',
		subject: basename(path) || path,
		annotation: [range, parentDirectory(path)].filter(Boolean).join(' · '),
		summary: countLines,
		body: 'text',
	}
}

function filePresentation(label: string, args: unknown): ToolPresentation {
	const path = payloadText(args, 'path')
	return {
		label,
		subject: basename(path) || path,
		annotation: parentDirectory(path),
		summary: countLines,
		body: 'native',
	}
}

function searchPresentation(
	label: 'grep' | 'glob',
	args: unknown,
): ToolPresentation {
	const root = payloadText(args, 'path') || '.'
	const filter = payloadText(args, 'glob')
	return {
		label,
		subject: payloadText(args, 'pattern'),
		annotation: `in ${root}${filter ? ` · ${filter}` : ''}`,
		summary: output => {
			const isEmpty =
				/^(?:No matches found|No files found matching pattern)\s*$/u.test(
					output.text,
				)
			const total = isEmpty
				? 0
				: outputLineCount(output.text.split(/\n\n\[/u)[0] ?? '')
			return count(label === 'grep' ? 'line' : 'file', total)
		},
		body: 'text',
	}
}

function bashPresentation(args: unknown): ToolPresentation {
	const preview = bashPreview(payloadText(args, 'command'))
	return {
		label: 'bash',
		subject: preview.subject,
		annotation: preview.annotation,
		timeoutSeconds: payloadNumber(args, 'timeout'),
		summary: countLines,
		body: 'text',
	}
}

const PRESENTATIONS = new Map<string, PresentTool>([
	['read', readPresentation],
	['edit', args => filePresentation('edit', args)],
	['write', args => filePresentation('write', args)],
	['ls', args => filePresentation('ls', args)],
	['grep', args => searchPresentation('grep', args)],
	['find', args => searchPresentation('glob', args)],
	['glob', args => searchPresentation('glob', args)],
	['bash', bashPresentation],
	...PACKAGE_PRESENTATIONS,
])

const SUBJECT_FIELDS = [
	'action',
	'path',
	'pattern',
	'query',
	'url',
	'command',
	'expression',
	'claim',
	'name',
	'id',
]

/** Fields that name the first element of a list argument, e.g. a questionnaire's first question. */
const ENTRY_FIELDS = ['label', 'prompt', 'name', 'id', 'query']

/** A readable label for a tool nobody registered vocabulary for; never its raw identifier. */
function displayLabel(name: string): string {
	return singleLine(name.replace(/[_-]+/gu, ' ')) || name
}

function firstEntryLabel(listEntry: unknown): string {
	return (
		ENTRY_FIELDS.map(field => payloadText(listEntry, field)).find(
			Boolean,
		) ?? ''
	)
}

function argumentSubject(argument: unknown): string {
	if (typeof argument === 'string') return argument.trim() ? argument : ''
	if (!Array.isArray(argument)) return ''
	for (const listEntry of argument) {
		const label = firstEntryLabel(listEntry)
		if (label) return label
	}
	return ''
}

function fallbackSubject(args: unknown): string {
	const known = SUBJECT_FIELDS.map(field => payloadText(args, field)).find(
		Boolean,
	)
	if (known) return known
	if (!args || typeof args !== 'object') return ''
	return Object.values(args).map(argumentSubject).find(Boolean) ?? ''
}

export function presentTool(name: string, args: unknown): ToolPresentation {
	const dedicated = PRESENTATIONS.get(name)
	const presentation = dedicated?.(args) ?? {
		label: displayLabel(name),
		subject: fallbackSubject(args),
		annotation: '',
		summary: countLines,
		body: 'native',
	}
	return {
		...presentation,
		label: singleLine(presentation.label),
		subject: singleLine(presentation.subject),
		annotation: singleLine(presentation.annotation),
	}
}

const LIMIT_FIELDS = [
	'matchLimitReached',
	'resultLimitReached',
	'entryLimitReached',
	'limitReached',
]

export function outputWarning(output: ToolOutput): string {
	const truncation = reflectMember(output.details, 'truncation')
	const isTruncated =
		reflectMember(truncation, 'truncated') === true ||
		reflectMember(output.details, 'linesTruncated') === true
	const hasLimit = LIMIT_FIELDS.some(field =>
		Boolean(reflectMember(output.details, field)),
	)
	return [isTruncated ? 'truncated' : '', hasLimit ? 'limit reached' : '']
		.filter(Boolean)
		.join(' · ')
}
