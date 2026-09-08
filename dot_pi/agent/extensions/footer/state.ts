// Shared mutable state of the footer extension. The extension is a process
// singleton per pi session; module state mirrors the adapter-map pattern used
// by the other pi extensions (e.g. ordered-widget-stack). Mutable handles are
// nullable, never optional: clearing sets null (see runtimeState in the
// container-sandbox extension for the same idiom).
import type { GitPr, GitStatus } from './git-data.ts'
import type { QuotaCache } from './quotas.ts'

export type FooterState = {
	isEnabled: boolean
	requestRender: (() => void) | null
	quotaCache: QuotaCache
	quotaTimer: ReturnType<typeof setInterval> | null
	gitCache: GitStatus | null
	gitTimer: ReturnType<typeof setInterval> | null
	gitCwd: string | null
	prCache: GitPr | null
	prTimer: ReturnType<typeof setInterval> | null
	prGeneration: number
	lifecycleGeneration: number
	isFooterInstalled: boolean
}

export const footerState: FooterState = {
	isEnabled: true,
	requestRender: null,
	quotaCache: {},
	quotaTimer: null,
	gitCache: null,
	gitTimer: null,
	gitCwd: null,
	prCache: null,
	prTimer: null,
	prGeneration: 0,
	lifecycleGeneration: 0,
	isFooterInstalled: false,
}
