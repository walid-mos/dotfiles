import { accessSync, constants, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'

import { getAgentDir } from '@earendil-works/pi-coding-agent'
import { Value } from 'typebox/value'

import { configSchema } from './config-schema.ts'
import { defaults } from './schema.ts'

import type { Config } from './schema.ts'

export const configPath = join(getAgentDir(), 'frontend-check.json')

export function validateConfig(input: unknown): Config {
	if (!Value.Check(configSchema, input)) {
		const errors = [...Value.Errors(configSchema, input)].map(
			error => `${error.instancePath}: ${error.message}`,
		)
		throw new Error(
			`Invalid frontend-check configuration: ${errors.join('; ')}`,
		)
	}
	return input
}

export function loadConfig(path = configPath): Config {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
			throw new Error('Expected a configuration object.')
		return validateConfig({ ...defaults, ...parsed })
	} catch (error) {
		if (
			error instanceof Error &&
			'code' in error &&
			error.code === 'ENOENT'
		)
			return { ...defaults }
		throw new Error(
			`Could not load ${path}; correct it before using frontend tools.`,
			{ cause: error },
		)
	}
}

export function updateConfig(config: Config, assignment: string): Config {
	const match = /^([A-Z_]+)=(.*)$/s.exec(assignment)
	if (!match)
		throw new Error(
			'Expected /frontend-check set KEY=VALUE (one setting at a time).',
		)
	const [, key = '', raw = ''] = match
	if (!isConfigKey(key))
		throw new Error(`Unknown frontend-check setting: ${key}`)
	const setting: unknown =
		typeof defaults[key] === 'string' ? raw : JSON.parse(raw)
	return validateConfig({ ...config, [key]: setting })
}

function isConfigKey(key: string): key is keyof Config {
	return Object.hasOwn(defaults, key)
}

function isExecutable(path: string): boolean {
	try {
		accessSync(path, constants.X_OK)
		return true
	} catch {
		return false
	}
}

export function resolveExecutable(configured: string): string {
	if (configured) {
		if (isAbsolute(configured) && isExecutable(configured))
			return configured
		throw new Error(
			`EXECUTABLE_PATH must name an executable absolute path: ${configured}`,
		)
	}
	const macRelative = 'Brave Browser.app/Contents/MacOS/Brave Browser'
	const candidates = [
		join('/Applications', macRelative),
		join(homedir(), 'Applications', macRelative),
		...(process.env.PATH ?? '')
			.split(delimiter)
			.filter(Boolean)
			.flatMap(directory =>
				['brave-browser', 'brave-browser-stable', 'brave'].map(name =>
					join(directory, name),
				),
			),
	]
	const executable = candidates.find(isExecutable)
	if (!executable)
		throw new Error(
			'Brave was not found. Install Brave or set EXECUTABLE_PATH to an installed Chromium-compatible browser. No browser is downloaded automatically.',
		)
	return executable
}
