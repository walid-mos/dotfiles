export const VERDICTS = [
	'PROCEED',
	'REVISE',
	'NEEDS_EVIDENCE',
	'READY',
] as const

export type Verdict = (typeof VERDICTS)[number]

export type VerdictLine = {
	verdict: Verdict
	fingerprint: string | null
	checkpoint: string | null
}

export const FINAL_CHECKPOINT = 'FINAL'

const VERDICT_WORD =
	/^(?:[^A-Za-z]|[Vv]erdict)*?(PROCEED|REVISE|NEEDS_EVIDENCE|READY)(?![A-Za-z0-9_])/
const FINGERPRINT_FIELD = /fingerprint\s*[=:]\s*[`"'*_]*([0-9a-f]+)/i
const CHECKPOINT_FIELD = /checkpoint\s*[=:]\s*[`"'*_]*([A-Za-z0-9-]+)/i

function isVerdict(candidate: string): candidate is Verdict {
	return VERDICTS.some(verdict => verdict === candidate)
}

export function parseVerdictLine(replyText: string): VerdictLine | undefined {
	const firstLine = replyText.split('\n').find(line => line.trim())
	if (!firstLine) return undefined
	const word = VERDICT_WORD.exec(firstLine)?.[1]
	if (!word || !isVerdict(word)) return undefined
	return {
		verdict: word,
		fingerprint: FINGERPRINT_FIELD.exec(firstLine)?.[1] ?? null,
		checkpoint: CHECKPOINT_FIELD.exec(firstLine)?.[1] ?? null,
	}
}

export type VerdictCheck =
	| { kind: 'accepted'; verdict: Verdict }
	| { kind: 'rejected'; reason: string }

export function checkVerdict(
	replyText: string,
	checkpoint: string,
	fingerprint: string,
): VerdictCheck {
	const line = parseVerdictLine(replyText)
	if (!line) {
		return {
			kind: 'rejected',
			reason: `first line must start with one of ${VERDICTS.join(', ')} followed by fingerprint=<value> checkpoint=<label>`,
		}
	}
	if (line.fingerprint !== fingerprint) {
		return {
			kind: 'rejected',
			reason: `reply echoes fingerprint ${line.fingerprint ?? 'none'}, packet carried ${fingerprint}`,
		}
	}
	if (line.checkpoint !== checkpoint) {
		return {
			kind: 'rejected',
			reason: `reply echoes checkpoint ${line.checkpoint ?? 'none'}, packet carried ${checkpoint}`,
		}
	}
	if (line.verdict === 'READY' && checkpoint !== FINAL_CHECKPOINT) {
		return {
			kind: 'rejected',
			reason: `READY is reserved for the ${FINAL_CHECKPOINT} checkpoint`,
		}
	}
	return { kind: 'accepted', verdict: line.verdict }
}
