import { visibleWidth } from '@earendil-works/pi-tui'

import { PI_PALETTE as LATTE } from '../ui/design-system/palette.ts'
import { foregroundHex as fgHex } from '../ui/design-system/terminal-color.ts'
import { truncateTerminalLine as truncateToWidth } from '../ui/terminal-text.ts'

import { BRANCH_DEGRADED_CHARS, BRANCH_MINIMAL_CHARS } from './git-scale.ts'
import { contextGroup } from './render-context.ts'
import { gitLine, gitWithPr } from './render-git.ts'
import { quotaStrip } from './render-quota.ts'
// Pure footer rendering (no IO): line 1 couples the hero pill with the
// provider quota strip, line 2 couples git/PR with statuses,
// context gauge, token arrows and cost. Exported for tests.
import {
	compactPath,
	fmtTokens,
	thinSep,
	PATH_COMPACT_MAX_CHARS,
} from './text.ts'
import { ICONS, SEP_THIN, THINKING_COLORS } from './theme.ts'

import type { ContextUsage } from '@earendil-works/pi-coding-agent'
import type { GitPr, GitStatus } from './git-data.ts'
import type { QuotaCache } from './quotas.ts'

/** Visible gap kept between left and right column bounds. */
const LINE_GAP = 2
// Vertical degradation ladder of the quiet path metadata
const PATH_SNUG_CHARS = 22
const PATH_TIGHT_CHARS = 18

// pi's own ContextUsage shape (single source of truth); the footer can only
// render it when the percent is finite (null right after compaction, etc.)

export type FooterRenderInput = {
	width: number
	model: string
	thinkingLevel: string
	cwd: string
	// The payload always carries every key; absent facts read as undefined
	branch: string | undefined
	usage: ContextUsage | undefined
	tokens: { input: number; output: number; cost: number }
	statuses: readonly string[]
	git: GitStatus | null
	pr: GitPr | null
	quotas: QuotaCache
	provider: string | undefined
}

type LayoutVariant = {
	pathMax: number
	willShowExactTokens: boolean
	willHideMeta?: boolean
}

// Progressive degradation: shrink quiet meta first, then drop exact tokens,
// then hide the meta block entirely. The hero pill, context gauge and cost
// are never dropped.
const DEGRADED_HOVER_VARIANT: LayoutVariant = {
	pathMax: PATH_TIGHT_CHARS,
	willShowExactTokens: false,
	willHideMeta: true,
}

const HOVER_VARIANTS: LayoutVariant[] = [
	{ pathMax: PATH_COMPACT_MAX_CHARS, willShowExactTokens: true },
	{ pathMax: PATH_SNUG_CHARS, willShowExactTokens: true },
	{ pathMax: PATH_TIGHT_CHARS, willShowExactTokens: false },
	DEGRADED_HOVER_VARIANT,
]

/** Left-aligned + right-aligned on one row, clamped to width. */
export function justifyLine(
	left: string,
	right: string,
	width: number,
): string {
	const pad = ' '.repeat(
		Math.max(1, width - visibleWidth(left) - visibleWidth(right)),
	)
	return truncateToWidth(`${left}${pad}${right}`, width)
}

/** Quiet flat metadata: colored icon + muted label. */
export function meta(icon: string, iconColor: string, label: string): string {
	return `${fgHex(iconColor, icon)} ${fgHex(LATTE.subtext0, label)}`
}

export function clampFooterLines(lines: string[], width: number): string[] {
	return lines.map(line =>
		visibleWidth(line) <= width ? line : truncateToWidth(line, width),
	)
}

// ── Line 1: hero pill left │ quota strip right ────────

function heroGroup(input: FooterRenderInput): string {
	const modelPill = `${fgHex(LATTE.mauve, ICONS.model)} ${fgHex(LATTE.text, input.model)}`
	const thinkingTint = THINKING_COLORS[input.thinkingLevel] ?? LATTE.subtext0
	const thinkingPill = fgHex(
		thinkingTint,
		`${ICONS.thinking} ${input.thinkingLevel}`,
	)
	return [modelPill, thinkingPill].join(` ${fgHex(LATTE.mauve, SEP_THIN)} `)
}

function heroLeftEdge(
	variant: LayoutVariant,
	input: FooterRenderInput,
	hero: string,
): string {
	if (variant.willHideMeta) return hero
	const pathPill = meta(
		ICONS.folder,
		LATTE.teal,
		compactPath(input.cwd, variant.pathMax),
	)
	return `${hero} ${thinSep()} ${pathPill}`
}

/** Line 1: hero pill │ quota strip, degrading the left edge first. */
function composeQuotaLine(
	input: FooterRenderInput,
	hero: string,
	width: number,
): string {
	for (const variant of HOVER_VARIANTS) {
		const left = heroLeftEdge(variant, input, hero)
		const right = quotaStrip(input.quotas, input.provider)
		if (visibleWidth(left) + visibleWidth(right) + LINE_GAP <= width) {
			return justifyLine(left, right, width)
		}
	}
	// Degraded: silent path edge and compact quota strip truncate instead
	const left = heroLeftEdge(DEGRADED_HOVER_VARIANT, input, hero)
	const right = quotaStrip(input.quotas, input.provider, { compact: true })
	const fits = visibleWidth(left) + visibleWidth(right) + LINE_GAP <= width
	return fits
		? justifyLine(left, right, width)
		: truncateToWidth(justifyLine(left, right, width), width)
}

// ── Line 2: git/PR left │ statuses, context, arrows, cost right ───────

function statusesColumn(statuses: readonly string[]): string {
	if (!statuses.length) return ''
	return statuses.join('  ')
}

function line2RightFull(
	input: FooterRenderInput,
	arrowsGroup: string,
	costGroup: string,
): string {
	const groups = [
		statusesColumn(input.statuses),
		input.usage ? contextGroup(input.usage, true) : '',
		arrowsGroup,
		costGroup,
	].filter(Boolean)
	return groups.join(` ${thinSep()} `)
}

function line2RightTerse(input: FooterRenderInput, costGroup: string): string {
	const groups = [
		statusesColumn(input.statuses),
		input.usage ? contextGroup(input.usage, false) : '',
		costGroup,
	].filter(Boolean)
	return groups.join(` ${thinSep()} `)
}

function line2RightMinimal(
	input: FooterRenderInput,
	costGroup: string,
): string {
	const groups = [statusesColumn(input.statuses), costGroup].filter(Boolean)
	return groups.join(` ${thinSep()} `)
}

function firstFittingRow(
	lefts: string[],
	right: string,
	width: number,
): string | undefined {
	for (const left of lefts) {
		if (visibleWidth(left) + visibleWidth(right) + LINE_GAP <= width) {
			return justifyLine(left, right, width)
		}
	}
	return undefined
}

/** Line 2: git left │ statuses + context + arrows + cost right. */
function composeStatusLine(
	input: FooterRenderInput,
	arrowsGroup: string,
	costGroup: string,
	width: number,
): string {
	const rights = [
		line2RightFull(input, arrowsGroup, costGroup),
		line2RightTerse(input, costGroup),
		line2RightMinimal(input, costGroup),
		costGroup,
	]
	const lefts = [
		gitWithPr(input.git, input.pr, input.branch),
		gitLine(input.git, input.branch),
		gitLine(input.git, input.branch, BRANCH_DEGRADED_CHARS),
		gitLine(input.git, input.branch, BRANCH_MINIMAL_CHARS),
		gitLine(input.git, undefined),
	]
	let line2: string | undefined
	for (const right of rights) {
		line2 = firstFittingRow(lefts, right, width)
		if (line2) break
	}
	const [primaryLeft = ''] = lefts
	line2 ??= truncateToWidth(justifyLine(primaryLeft, costGroup, width), width)
	return line2
}

const COST_DECIMALS = 3

/** Compose both footer lines; the degradation ladders guarantee a fit. */
export function renderFooterLines(input: FooterRenderInput): string[] {
	const width = Math.max(0, input.width)
	const hero = heroGroup(input)
	const line1 = composeQuotaLine(input, hero, width)
	const arrowsGroup = fgHex(
		LATTE.subtext0,
		`↑${fmtTokens(input.tokens.input)} ↓${fmtTokens(input.tokens.output)}`,
	)
	const costGroup = fgHex(
		LATTE.text,
		`$${input.tokens.cost.toFixed(COST_DECIMALS)}`,
	)
	const line2 = composeStatusLine(input, arrowsGroup, costGroup, width)
	return [line1, line2]
}
