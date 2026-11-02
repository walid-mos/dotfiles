import { computeFingerprint } from './lib-fingerprint.ts'
import { lastRound, readState } from './lib-state.ts'
import { FINAL_CHECKPOINT } from './lib-verdict.ts'

export type VerifyOutcome = {
	isApproved: boolean
	readyRound: number | null
	readyFingerprint: string | null
	currentFingerprint: string | null
	reason: string
}

const READY_VERDICT = 'READY'

export function verifyDelivery(stateDirectory: string): VerifyOutcome {
	const state = readState(stateDirectory)
	const round = lastRound(state)
	const refused = {
		isApproved: false,
		readyRound: null,
		readyFingerprint: null,
		currentFingerprint: null,
	}
	if (!round) return { ...refused, reason: 'no round recorded' }
	if (
		round.verdict !== READY_VERDICT ||
		round.checkpoint !== FINAL_CHECKPOINT
	) {
		return {
			...refused,
			reason: `last round ${round.number} is ${round.verdict} on ${round.checkpoint}, not ${READY_VERDICT} on ${FINAL_CHECKPOINT}`,
		}
	}
	const currentFingerprint = computeFingerprint(round.scope).value
	const isApproved = currentFingerprint === round.fingerprint
	return {
		isApproved,
		readyRound: round.number,
		readyFingerprint: round.fingerprint,
		currentFingerprint,
		reason: isApproved
			? 'the delivered tree is the one the advisor approved'
			: 'the tree changed after READY; send a new FINAL packet',
	}
}
