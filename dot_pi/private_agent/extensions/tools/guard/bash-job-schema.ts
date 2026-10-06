import { Type } from 'typebox'

import type { Static } from 'typebox'

export const FOREGROUND_MS = 10_000
export const COMPLETION_WAIT_MS = 60_000
export const STOP_GRACE_MS = 2_000
export const MAX_RUNNING_JOBS = 16
export const MAX_FINISHED_JOBS = 32
export const JOB_COMMAND_BYTES = 512
export const JOB_PREVIEW_BYTES = 8_192
export const JOB_PREVIEW_LINES = 80

export const managedBashSchema = Type.Object({
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
				Type.Literal('wait'),
				Type.Literal('stop'),
			],
			{
				description: `Default run. Other actions manage this session's existing jobs without starting another command. wait waits up to ${COMPLETION_WAIT_MS}ms for completion; do not poll in a loop. Prefer the completion notification. status reads current progress without waiting; stop cancels.`,
			},
		),
	),
	jobId: Type.Optional(
		Type.String({
			description:
				'Required for status, wait, stop. Use the ID returned by run or list.',
		}),
	),
	timeout: Type.Optional(
		Type.Number({
			minimum: 0.001,
			description:
				'Command lifetime in SECONDS, not milliseconds. Omit for no lifetime deadline. Never extends the foreground wait.',
		}),
	),
	yieldMs: Type.Optional(
		Type.Integer({
			minimum: 0,
			maximum: FOREGROUND_MS,
			description: `Foreground wait in milliseconds, default ${FOREGROUND_MS}. Use 0 for servers. A running command becomes a job; it is not restarted or killed.`,
		}),
	),
})
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
