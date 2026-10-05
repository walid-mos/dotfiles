/**
 * Publishes the live Pi branch and offers /tab-name. One elected Pi session
 * reads declared goals and owns automatic names; no external service is needed.
 * contracts/storage own state; tasks/summarize/coordinator own naming policy.
 */
import { Value } from 'typebox/value'

import { activeGoal } from '#lib/goal/state.ts'

import { POLL_MS, Title, TITLE_LIMIT } from './contracts.ts'
import { renameTab, snapshot } from './herdr.ts'
import { startNaming } from './service.ts'
import { requestAutomatic, saveJson, selectionPath } from './storage.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'

function registerTabCommand(pi: ExtensionAPI, paneId: string): void {
	pi.registerCommand('tab-name', {
		description:
			'Name this Herdr tab manually, or use auto to restore task-based naming',
		handler: async (args, ctx) => {
			const name = args.trim()
			if (!Value.Check(Title, name)) {
				ctx.ui.notify(
					`Use /tab-name <name up to ${TITLE_LIMIT} characters> or /tab-name auto.`,
					'warning',
				)
				return
			}
			const current = await snapshot()
			const pane = current.panes.find(
				candidate => candidate.pane_id === paneId,
			)
			if (!pane)
				throw new Error(
					'This Pi pane is no longer in the configured Herdr session',
				)
			if (name === 'auto') await requestAutomatic(pane.tab_id)
			else await renameTab(pane.tab_id, name)
			ctx.ui.notify(
				name === 'auto'
					? 'Automatic tab naming requested.'
					: `Tab named ${name}. Automatic naming is paused for this tab.`,
				'info',
			)
		},
	})
}

function branchPublisher(
	paneId: string,
): (ctx: ExtensionContext) => Promise<void> {
	let previous = ''
	let pending = Promise.resolve()
	const publish = async (ctx: ExtensionContext): Promise<void> => {
		if (ctx.mode !== 'tui') return
		const session = ctx.sessionManager.getSessionFile()
		if (!session) return
		const goal = activeGoal(ctx.sessionManager.getBranch())
		const signature = JSON.stringify({ session, goal })
		if (signature === previous) return
		await saveJson(selectionPath(paneId), {
			session,
			leaf: ctx.sessionManager.getLeafId(),
		})
		previous = signature
	}
	return ctx => {
		const prior = pending
		pending = (async () => {
			try {
				await prior
			} catch {
				previous = ''
			}
			await publish(ctx)
		})()
		return pending
	}
}

async function publishInBackground(
	publish: (ctx: ExtensionContext) => Promise<void>,
	ctx: ExtensionContext,
): Promise<void> {
	try {
		await publish(ctx)
	} catch (cause) {
		ctx.ui.notify(`Herdr branch reporting: ${String(cause)}`, 'warning')
	}
}

export default function taskNames(pi: ExtensionAPI): void {
	if (process.env.HERDR_ENV !== '1' || process.env.PI_SUBAGENT_CHILD === '1')
		return
	const paneId = process.env.HERDR_PANE_ID
	if (!paneId) return
	registerTabCommand(pi, paneId)
	const publishBranch = branchPublisher(paneId)
	let timer: ReturnType<typeof setInterval> | undefined
	let stopNaming: (() => Promise<void>) | undefined
	pi.on('session_start', async (_event, ctx) => {
		if (ctx.mode !== 'tui') return
		clearInterval(timer)
		await stopNaming?.()
		await publishInBackground(publishBranch, ctx)
		stopNaming = startNaming(ctx.modelRegistry, message =>
			ctx.ui.notify(message, 'warning'),
		)
		timer = setInterval(() => {
			void publishInBackground(publishBranch, ctx)
		}, POLL_MS)
		timer.unref()
	})
	pi.on('session_shutdown', async () => {
		clearInterval(timer)
		await stopNaming?.()
		stopNaming = undefined
	})
	pi.on('session_tree', async (_event, ctx) => {
		await publishBranch(ctx)
	})
	pi.on('tool_result', async (_event, ctx) => {
		await publishBranch(ctx)
	})
	pi.on('agent_settled', async (_event, ctx) => {
		await publishBranch(ctx)
	})
}
