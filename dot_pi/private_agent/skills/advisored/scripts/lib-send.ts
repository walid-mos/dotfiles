import { readFileSync, writeFileSync } from 'node:fs'

import { checkClaudeReply, claudeArguments } from './lib-backend-claude.ts'
import { checkPiReply, piArguments } from './lib-backend-pi.ts'
import { gatherEvidence } from './lib-evidence.ts'
import { computeFingerprint } from './lib-fingerprint.ts'
import { recordMaterial } from './lib-material.ts'
import { renderPacket } from './lib-packet.ts'
import { describeFailure, runProcess } from './lib-process.ts'
import { roundFiles } from './lib-round-files.ts'
import { checkContract, lastRound, readState, writeState } from './lib-state.ts'
import { checkVerdict } from './lib-verdict.ts'

import type { AcceptedReply, ReplyCheck } from './lib-backend-claude.ts'
import type { EvidenceBlock } from './lib-packet.ts'
import type { ProcessOutcome } from './lib-process.ts'
import type { RoundFiles } from './lib-round-files.ts'
import type { AdvisorState, FingerprintScope } from './lib-state.ts'

export type SendRequest = {
	stateDirectory: string
	checkpoint: string
	scope: FingerprintScope
	bodyPath: string
	timeoutMs: number
}

export type SendOutcome =
	| {
			kind: 'accepted'
			round: number
			verdict: string
			fingerprint: string
			replyPath: string
			model: string
			costUsd: number | null
	  }
	| {
			kind: 'rejected'
			round: number
			reason: string
			replyPath: string | null
	  }
	| { kind: 'precondition'; reason: string }
	| { kind: 'process'; round: number; reason: string; stderrPath: string }

type RoundContext = {
	state: AdvisorState
	request: SendRequest
	files: RoundFiles
	fingerprint: string
}

const PRIVATE_FILE_MODE = 0o600

function writePrivate(path: string, content: string): void {
	writeFileSync(path, content, { mode: PRIVATE_FILE_MODE })
}

function buildPacket(
	{ state, request, files, fingerprint }: RoundContext,
	evidence: readonly EvidenceBlock[],
): string {
	const previous = lastRound(state)
	return renderPacket({
		checkpoint: request.checkpoint,
		round: files.round,
		fingerprint,
		request: readFileSync(state.requestPath, 'utf8'),
		ledger: readFileSync(state.ledgerPath, 'utf8'),
		previousReply: previous
			? readFileSync(previous.replyPath, 'utf8')
			: null,
		material: recordMaterial(request.scope.repo),
		evidence,
		implementer: readFileSync(request.bodyPath, 'utf8'),
	})
}

function launch(
	{ state, request, files }: RoundContext,
	packet: string,
): ProcessOutcome {
	const isClaude = state.backend === 'claude'
	return runProcess({
		command: isClaude ? 'claude' : 'pi',
		arguments: isClaude
			? claudeArguments(state)
			: piArguments(state, request.stateDirectory, files.label),
		cwd: state.cwd,
		stdin: packet,
		timeoutMs: request.timeoutMs,
	})
}

function checkReply(
	stdout: string,
	{ state, request, files }: RoundContext,
): ReplyCheck {
	return state.backend === 'claude'
		? checkClaudeReply(stdout, state)
		: checkPiReply(stdout, state, request.stateDirectory, files.label)
}

function recordRound(
	{ state, request, files, fingerprint }: RoundContext,
	reply: AcceptedReply,
	verdict: string,
): AdvisorState {
	return {
		...state,
		model: state.backend === 'claude' ? reply.model : state.model,
		rounds: [
			...state.rounds,
			{
				number: files.round,
				checkpoint: request.checkpoint,
				fingerprint,
				scope: request.scope,
				verdict,
				packetPath: files.packetPath,
				replyPath: files.replyPath,
				model: reply.model,
				costUsd: reply.costUsd,
				evidenceCount: state.evidence.length,
			},
		],
	}
}

function settleReply(context: RoundContext, check: ReplyCheck): SendOutcome {
	const { request, files, fingerprint } = context
	if (check.kind === 'rejected') {
		if (check.text) writePrivate(files.replyPath, check.text)
		return {
			kind: 'rejected',
			round: files.round,
			reason: check.reason,
			replyPath: check.text ? files.replyPath : null,
		}
	}
	writePrivate(files.replyPath, check.reply.text)
	const verdict = checkVerdict(
		check.reply.text,
		request.checkpoint,
		fingerprint,
	)
	if (verdict.kind === 'rejected') {
		return {
			kind: 'rejected',
			round: files.round,
			reason: verdict.reason,
			replyPath: files.replyPath,
		}
	}
	writeState(
		request.stateDirectory,
		recordRound(context, check.reply, verdict.verdict),
	)
	return {
		kind: 'accepted',
		round: files.round,
		verdict: verdict.verdict,
		fingerprint,
		replyPath: files.replyPath,
		model: check.reply.model,
		costUsd: check.reply.costUsd,
	}
}

export function sendPacket(request: SendRequest): SendOutcome {
	const state = readState(request.stateDirectory)
	const contract = checkContract(state)
	if (contract.kind === 'changed')
		return { kind: 'precondition', reason: contract.reason }
	const evidence = gatherEvidence(state)
	if (evidence.kind === 'tampered')
		return { kind: 'precondition', reason: evidence.reason }
	const context: RoundContext = {
		state,
		request,
		files: roundFiles(request.stateDirectory, state, request.checkpoint),
		fingerprint: computeFingerprint(request.scope).value,
	}
	const packet = buildPacket(context, evidence.blocks)
	writePrivate(context.files.packetPath, packet)
	const outcome = launch(context, packet)
	writePrivate(context.files.stderrPath, outcome.stderr)
	writePrivate(context.files.rawReplyPath, outcome.stdout)
	if (outcome.exitCode !== 0 || outcome.isTimedOut) {
		return {
			kind: 'process',
			round: context.files.round,
			reason: `${state.backend} ${describeFailure(outcome)}`,
			stderrPath: context.files.stderrPath,
		}
	}
	return settleReply(context, checkReply(outcome.stdout, context))
}
