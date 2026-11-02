import { Type } from 'typebox'

import type { Static } from 'typebox'

export const FOREGROUND_MS = 120_000
export const MAX_FOREGROUND_MS = 600_000
export const STOP_GRACE_MS = 2_000
export const MAX_RUNNING_JOBS = 16
export const MAX_FINISHED_JOBS = 32
export const JOB_COMMAND_BYTES = 512
export const JOB_PREVIEW_BYTES = 8_192
export const JOB_PREVIEW_LINES = 80

export const managedBashSchema = Type.Object(
	{
		command: Type.Optional(
			Type.String({
				description:
					'Shell command. Required for run; omit for job controls.',
			}),
		),
		action: Type.Optional(
			Type.Union(
				[
					Type.Literal('run'),
					Type.Literal('list'),
					Type.Literal('status'),
					Type.Literal('stop'),
				],
				{
					description:
						"Default run. Other actions manage this session's existing jobs without starting another command: list shows them, status reads progress once per running job (a second status on the same running job is refused: completion notifies this session), stop cancels. There is no wait action.",
				},
			),
		),
		jobId: Type.Optional(
			Type.String({
				description:
					'Required for status and stop. Use the ID returned by run or list.',
			}),
		),
		timeout: Type.Optional(
			Type.Number({
				minimum: 0.001,
				description:
					'Command lifetime in SECONDS, not milliseconds. Omit for no lifetime deadline. Never extends the foreground window.',
			}),
		),
		foregroundMs: Type.Optional(
			Type.Integer({
				minimum: FOREGROUND_MS,
				maximum: MAX_FOREGROUND_MS,
				description: `Milliseconds this call stays open for the command to finish, default ${FOREGROUND_MS}, at most ${MAX_FOREGROUND_MS}. It can only be lengthened: an open call costs no tokens, while a command that outlives it becomes a job whose completion costs a turn. Set it for a command known to run long whose result this turn needs.`,
			}),
		),
		background: Type.Optional(
			Type.Boolean({
				description:
					'true returns at once with a running jobId instead of keeping the call open: servers, and work whose result this turn does not need. Completion notifies this session.',
			}),
		),
	},
	{ additionalProperties: false },
)
export type ManagedBashInput = Static<typeof managedBashSchema>

export const jobSnapshotSchema = Type.Object({
	jobId: Type.String(),
	command: Type.String(),
	cwd: Type.String(),
	status: Type.Union([
		Type.Literal('running'),
		Type.Literal('stopping'),
		Type.Literal('completed'),
		Type.Literal('failed'),
		Type.Literal('cancelled'),
	]),
	startedAt: Type.Number(),
	finishedAt: Type.Optional(Type.Number()),
	receiptPath: Type.Optional(Type.String()),
	persistenceError: Type.Optional(Type.String()),
	notificationError: Type.Optional(Type.String()),
	fullOutputPath: Type.Optional(Type.String()),
})
export type JobSnapshot = Static<typeof jobSnapshotSchema>
