import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

import { Type } from 'typebox'
import { Value } from 'typebox/value'

const manifestSchema = Type.Record(Type.String(), Type.Unknown())

export interface VendoredPackage {
	root: string
	name: string
	auditEntry: string
}

export function readRecord(file: string): Record<string, unknown> {
	const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
	if (!Value.Check(manifestSchema, parsed))
		throw new Error(`Expected a JSON object in ${file}`)
	return parsed
}

function containedFile(root: string, entry: string): string {
	const file = realpathSync(resolve(root, entry))
	const inside = relative(root, file)
	if (
		isAbsolute(inside) ||
		inside === '..' ||
		inside.startsWith(`..${sep}`) ||
		!statSync(file).isFile()
	)
		throw new Error(`Package audit must be a file inside ${root}: ${entry}`)
	return file
}

export function vendoredRoots(agentDirectory: string): string[] {
	const directory = join(agentDirectory, 'packages')
	return readdirSync(directory, { withFileTypes: true })
		.filter(
			entry =>
				!entry.name.startsWith('.') &&
				(entry.isDirectory() || entry.isSymbolicLink()),
		)
		.map(entry => join(directory, entry.name))
		.toSorted()
}

export function vendoredPackages(agentDirectory: string): VendoredPackage[] {
	return vendoredRoots(agentDirectory).map(root => {
		const manifest = readRecord(join(root, 'package.json'))
		if (typeof manifest.name !== 'string' || !manifest.name.trim())
			throw new Error(`Missing package name in ${root}/package.json`)
		if (
			typeof manifest.piAudit !== 'string' ||
			!manifest.piAudit.startsWith('./')
		)
			throw new Error(
				`${manifest.name}: package.json must declare piAudit as a ./relative runtime audit entry`,
			)
		return {
			root: realpathSync(root),
			name: manifest.name,
			auditEntry: containedFile(realpathSync(root), manifest.piAudit),
		}
	})
}

const EXCLUDED_DIRECTORIES = new Set([
	'node_modules',
	'.git',
	'dist',
	'build',
	'test',
	'tests',
	'coverage',
])

export function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
		const file = join(directory, entry.name)
		if (entry.isDirectory())
			return EXCLUDED_DIRECTORIES.has(entry.name) ? [] : sourceFiles(file)
		return entry.isFile() &&
			/\.(?:[cm]?[jt]sx?)$/.test(entry.name) &&
			!/\.(?:test|spec)\./.test(entry.name)
			? [file]
			: []
	})
}
