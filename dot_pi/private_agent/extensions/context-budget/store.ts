/** Persist the user-selected ceiling and the dedicated summary model. */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_CEILING_TOKENS, MIN_CEILING } from './budget.ts'

import type { Ceiling } from './budget.ts'

export const STATE_FILE = 'context-budget.json'
export const DEFAULT_SUMMARY_MODEL = 'deepseek/deepseek-v4-flash'

export type SummaryModel = {
	provider: string
	id: string
}

type StoredBudget = {
	ceilingTokens: Ceiling
	summaryModel: string
}

export function readCeiling(agentDir: string): Ceiling {
	return readBudget(agentDir).ceilingTokens
}

export function readSummaryModel(agentDir: string): SummaryModel {
	const written = readBudget(agentDir).summaryModel
	const separator = written.indexOf('/')
	if (separator <= 0 || separator === written.length - 1) {
		return splitSummaryModel(DEFAULT_SUMMARY_MODEL)
	}
	return {
		provider: written.slice(0, separator),
		id: written.slice(separator + 1),
	}
}

export function writeCeiling(agentDir: string, ceiling: Ceiling): void {
	const { summaryModel } = readBudget(agentDir)
	mkdirSync(agentDir, { recursive: true })
	writeFileSync(
		join(agentDir, STATE_FILE),
		`${JSON.stringify({ ceilingTokens: ceiling, summaryModel }, null, '\t')}\n`,
	)
}

function readBudget(agentDir: string): StoredBudget {
	try {
		const parsed: unknown = JSON.parse(
			readFileSync(join(agentDir, STATE_FILE), 'utf8'),
		)
		return parseBudget(parsed)
	} catch {
		return defaultBudget()
	}
}

function parseBudget(parsed: unknown): StoredBudget {
	if (typeof parsed !== 'object' || parsed === null) return defaultBudget()
	const ceiling = Reflect.get(parsed, 'ceilingTokens')
	const summaryModel = Reflect.get(parsed, 'summaryModel')
	return {
		ceilingTokens: validCeiling(ceiling),
		summaryModel:
			typeof summaryModel === 'string' && summaryModel.includes('/')
				? summaryModel
				: DEFAULT_SUMMARY_MODEL,
	}
}

function validCeiling(candidate: unknown): Ceiling {
	if (candidate === 'off') return candidate
	if (
		typeof candidate === 'number' &&
		Number.isFinite(candidate) &&
		candidate >= MIN_CEILING
	) {
		return candidate
	}
	return DEFAULT_CEILING_TOKENS
}

function defaultBudget(): StoredBudget {
	return {
		ceilingTokens: DEFAULT_CEILING_TOKENS,
		summaryModel: DEFAULT_SUMMARY_MODEL,
	}
}

function splitSummaryModel(written: string): SummaryModel {
	const separator = written.indexOf('/')
	return {
		provider: written.slice(0, separator),
		id: written.slice(separator + 1),
	}
}
