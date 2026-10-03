import { hyperlink } from '@earendil-works/pi-tui'

import { PI_PALETTE as LATTE } from '#lib/ui/design-system/palette.ts'
import { foregroundHex as fgHex } from '#lib/ui/design-system/terminal-color.ts'

import {
	BRANCH_MAX_CHARS,
	CHURN_BAR_FULL_CHURN,
	GIT_BAR_WIDTH,
} from './git-scale.ts'
// Line-2 git rendering: churn meter and counters. The PR link and the review
// desk link moved to the contextual line above the prompt (context-line.ts).
import { bracketed, clampText, quietText, thinSep } from './text.ts'
import { BAR_EMPTY, BAR_FULL, ICONS } from './theme.ts'

import type { GitPr, GitStatus } from './git-data.ts'
import type { SynevaDesk } from './syneva-data.ts'

/** Rounded slim meter filled by working-tree churn, tinted by severity. */
export function gitSlimBar(total: number, color: string): string {
	const filled = Math.max(
		1,
		Math.min(
			GIT_BAR_WIDTH,
			Math.round((total / CHURN_BAR_FULL_CHURN) * GIT_BAR_WIDTH),
		),
	)
	const filledCells = fgHex(color, BAR_FULL.repeat(filled))
	const emptyCells = fgHex(
		LATTE.surface1,
		BAR_EMPTY.repeat(GIT_BAR_WIDTH - filled),
	)
	return filledCells + emptyCells
}

/** Churn severity: deletions > edits > staged work > untracked noise. */
export function churnColor(status: GitStatus): string {
	if (status.deleted > 0) return LATTE.red
	if (status.modified > 0) return LATTE.yellow
	if (status.staged > 0) return LATTE.green
	return LATTE.sapphire
}

function branchGroup(branch: string, maxBranch: number): string {
	const branchIcon = fgHex(LATTE.sapphire, ICONS.branch)
	const branchName = fgHex(LATTE.sapphire, clampText(branch, maxBranch))
	return `${branchIcon} ${branchName}`
}

function cleanGroup(): string {
	return `${fgHex(LATTE.green, '\u2713')}${quietText(' clean')}`
}

/** Pull then push, kept beside the branch even when the working tree is clean. */
function syncGroup(status: GitStatus): string {
	if (status.sync === 'detached') return quietText('detached')
	if (status.sync === 'local') return quietText('no upstream')
	if (status.sync === 'unavailable') return quietText('⇅ ?')
	const pull =
		status.behind > 0
			? fgHex(LATTE.peach, `↓${status.behind}`)
			: quietText('↓0')
	const push =
		status.ahead > 0
			? fgHex(LATTE.mauve, `↑${status.ahead}`)
			: quietText('↑0')
	return `${pull} ${push}`
}

/** Staged/modified/deleted/untracked/stash counters, dot separated. */
export function churnCounter(status: GitStatus): string {
	const midDot = quietText('\u00b7')
	const counters: string[] = []
	if (status.staged > 0)
		counters.push(fgHex(LATTE.green, `\u271a${status.staged}`))
	if (status.modified > 0)
		counters.push(fgHex(LATTE.yellow, `~${status.modified}`))
	if (status.deleted > 0)
		counters.push(fgHex(LATTE.red, `-${status.deleted}`))
	if (status.untracked > 0) {
		counters.push(fgHex(LATTE.subtext0, `?${status.untracked}`))
	}
	if (status.stash > 0) {
		counters.push(fgHex(LATTE.sapphire, `\u2691${status.stash}`))
	}
	return counters.join(` ${midDot} `)
}

const CLEAN_CHURN = 0

/** Line 2 left: branch + sync │ clean, or slim churn bar + counters. */
export function gitLine(
	status: GitStatus | null,
	branch?: string,
	maxBranch: number = BRANCH_MAX_CHARS,
): string {
	const groups: string[] = []
	const identity = branch ? branchGroup(branch, maxBranch) : ''
	const sync = status ? syncGroup(status) : ''
	const branchAndSync = [identity, sync].filter(Boolean).join('  ')
	if (branchAndSync) groups.push(branchAndSync)
	if (status === null) {
		groups.push(quietText('no git'))
		return groups.join(` ${thinSep()} `)
	}
	const churn =
		status.staged + status.modified + status.deleted + status.untracked
	if (churn === CLEAN_CHURN) {
		groups.push(cleanGroup())
		if (status.stash > 0) groups.push(churnCounter(status))
		return groups.join(` ${thinSep()} `)
	}
	groups.push(gitSlimBar(churn, churnColor(status)))
	groups.push(churnCounter(status))
	return groups.join(` ${thinSep()} `)
}

/** Clickable bracketed `[PR #n]` (OSC 8). Empty when no PR is cached. */
export function prLink(pr: GitPr | null): string {
	if (!pr) return ''
	const linkText = bracketed(fgHex(LATTE.blue, `PR #${pr.number}`))
	return hyperlink(linkText, pr.url)
}

/** Clickable bracketed `[review]` (OSC 8): this Pi session's live Syneva desk. */
export function reviewLink(desk: SynevaDesk | null): string {
	if (!desk) return ''
	const linkText = bracketed(fgHex(LATTE.peach, 'review'))
	return hyperlink(linkText, desk.url)
}
