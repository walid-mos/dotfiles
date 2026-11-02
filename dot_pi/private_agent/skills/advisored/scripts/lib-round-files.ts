import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import type { AdvisorState } from './lib-state.ts'

export type RoundFiles = {
	round: number
	label: string
	packetPath: string
	rawReplyPath: string
	stderrPath: string
	replyPath: string
}

export const PACKETS_DIRECTORY = 'packets'
export const REPLIES_DIRECTORY = 'replies'
const ROUND_DIGITS = 3
const UNSAFE_LABEL = /[^A-Za-z0-9-]/g

function attemptSuffix(packetsDirectory: string, base: string): string {
	const attempts = readdirSync(packetsDirectory).filter(
		name => name.startsWith(`${base}.`) || name.startsWith(`${base}-retry`),
	).length
	return attempts ? `-retry${attempts}` : ''
}

export function roundFiles(
	stateDirectory: string,
	state: AdvisorState,
	checkpoint: string,
): RoundFiles {
	const round = state.rounds.length + 1
	const packetsDirectory = join(stateDirectory, PACKETS_DIRECTORY)
	const base = `${String(round).padStart(ROUND_DIGITS, '0')}-${checkpoint.replaceAll(UNSAFE_LABEL, '-')}`
	const label = `${base}${attemptSuffix(packetsDirectory, base)}`
	const rawExtension = state.backend === 'claude' ? 'raw.json' : 'raw.txt'
	const repliesDirectory = join(stateDirectory, REPLIES_DIRECTORY)
	return {
		round,
		label,
		packetPath: join(packetsDirectory, `${label}.md`),
		rawReplyPath: join(repliesDirectory, `${label}.${rawExtension}`),
		stderrPath: join(repliesDirectory, `${label}.stderr.txt`),
		replyPath: join(repliesDirectory, `${label}.md`),
	}
}
