// Runinfra remaining credit balance for the current workspace.
import { foregroundHex as fgHex } from '#lib/ui/design-system/terminal-color.ts'

import { balanceColor } from './gauge.ts'
import { quietText } from './text.ts'

import type { RuninfraQuota } from './quota-runinfra.ts'

const USD_DECIMALS = 2

export function runinfraSegment(quota: RuninfraQuota): string {
	const tint = balanceColor(quota.balance)
	return `${quietText('runinfra')} ${fgHex(tint, '◉')} ${fgHex(tint, `$${quota.balance.toFixed(USD_DECIMALS)}`)}`
}
