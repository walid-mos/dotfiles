/** Wake the Boat at session start and keep `ws-<hash> · front :4321 · api :8787` in the footer statuses. */
import { refreshTarget, resumeTarget } from '#lib/runtime/anchor.ts'

import { boatFileCompletion } from './file-completion.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { Anchor, WorkspaceTarget } from '#lib/runtime/anchor.ts'

const STATUS_KEY = 'workspace'
const REFRESH_MS = 10_000

export function watchBoat(pi: ExtensionAPI, anchor: Anchor): void {
	let timer: ReturnType<typeof setInterval> | undefined
	pi.on('session_start', async (_event, ctx) => {
		const target = await wake(anchor, ctx)
		show(ctx, target)
		if (!ctx.hasUI) return
		ctx.ui.addAutocompleteProvider(boatFileCompletion(anchor))
		timer = setInterval(() => {
			void refresh(anchor, ctx)
		}, REFRESH_MS)
		timer.unref()
	})
	pi.on('session_shutdown', () => clearInterval(timer))
}

async function wake(
	anchor: Anchor,
	ctx: ExtensionContext,
): Promise<WorkspaceTarget> {
	const target = await refreshTarget(anchor)
	if (target.isLive) return target
	ctx.ui.notify(`Boat ${target.host} is stopped: waking it`, 'info')
	return resumeTarget(anchor)
}

async function refresh(anchor: Anchor, ctx: ExtensionContext): Promise<void> {
	try {
		show(ctx, await refreshTarget(anchor))
	} catch {
		ctx.ui.setStatus(STATUS_KEY, `${anchor.repo} · unreachable`)
	}
}

function show(ctx: ExtensionContext, target: WorkspaceTarget): void {
	const ports = target.ports.map(
		port => `${port.name.replace(/^@[^/]+\//, '')} :${port.port}`,
	)
	const state = target.isLive ? ports : ['stopped']
	ctx.ui.setStatus(STATUS_KEY, [target.host, ...state].join(' · '))
}
