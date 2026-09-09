import { hyperlink } from '@earendil-works/pi-tui'

import { PI_PALETTE as LATTE } from '../ui/design-system/palette.ts'
import { foregroundHex as fgHex } from '../ui/design-system/terminal-color.ts'

import {
	BRANCH_MAX_CHARS,
	CHURN_BAR_FULL_CHURN,
	GIT_BAR_WIDTH,
} from './git-scale.ts'
// Line-2 git/PR rendering: churn meter, counters and the branch pill.
import { clampText, quietText, thinSep } from './text.ts'
import { BAR_EMPTY, BAR_FULL, ICONS } from './theme.ts'

import type { GitPr, GitStatus } from './git-data.ts'

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

/** Ahead/behind/staged/modified/deleted/untracked counters, dot separated. */
export function churnCounter(status: GitStatus): string {
	const midDot = quietText('\u00b7')
	const counters: string[] = []
	if (status.ahead > 0)
		counters.push(fgHex(LATTE.mauve, `\u21d1${status.ahead}`))
	if (status.behind > 0)
		counters.push(fgHex(LATTE.mauve, `\u21d3${status.behind}`))
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

/** Line 2 left: branch │ slim churn bar + counters (+ PR link appended later). */
export function gitLine(
	status: GitStatus | null,
	branch?: string,
	maxBranch: number = BRANCH_MAX_CHARS,
): string {
	const groups: string[] = []
	if (branch) {
		groups.push(branchGroup(branch, maxBranch))
	}
	if (status === null) {
		groups.push(quietText('no git'))
		return groups.join(` ${thinSep()} `)
	}
	const churn =
		status.staged + status.modified + status.deleted + status.untracked
	if (churn === CLEAN_CHURN) {
		groups.push(cleanGroup())
		return groups.join(` ${thinSep()} `)
	}
	groups.push(gitSlimBar(churn, churnColor(status)))
	groups.push(churnCounter(status))
	return groups.join(` ${thinSep()} `)
}

/** Clickable `PR #n` (OSC 8). Empty when no PR is cached. */
export function prLink(pr: GitPr | null): string {
	if (!pr) return ''
	const linkText = fgHex(LATTE.blue, `PR #${pr.number}`)
	return hyperlink(linkText, pr.url)
}

/** Branch meter + PR link, joined and separated. */
export function gitWithPr(
	status: GitStatus | null,
	pr: GitPr | null,
	branch?: string,
	maxBranch: number = BRANCH_MAX_CHARS,
): string {
	const groups = [gitLine(status, branch, maxBranch), prLink(pr)].filter(
		Boolean,
	)
	return groups.join(` ${thinSep()} `)
}
