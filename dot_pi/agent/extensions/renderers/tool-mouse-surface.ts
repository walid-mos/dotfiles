/** Pi mouse coordinates: a click toggles either view; drag/release are not clicks. */
import { invokePiMethod, reflectMember } from '../ui/pi-members.ts'

import { payloadNumber, payloadText } from './tool-payload.ts'

import type { ToolRow } from './tool-row.ts'

export function toolMouseSurface(
	host: object,
	event: unknown,
	row: ToolRow,
): unknown {
	const y = payloadNumber(event, 'y') ?? -1
	const height = payloadNumber(host, 'selfRenderHeight') ?? 0
	const isExpanded = reflectMember(host, 'expanded') === true
	const isPreviewTarget = row.showsChanges() && y > 0 && y < height
	if (
		payloadText(event, 'type') === 'click' &&
		payloadText(event, 'button') === 'left' &&
		(y === 0 || isPreviewTarget)
	) {
		invokePiMethod(host, 'setExpanded', !isExpanded)
		return { handled: true }
	}
	// Selection gestures stay with the TUI rather than Pi's click-to-toggle fallback.
	if (row.showsChanges()) return undefined
	return invokePiMethod(
		reflectMember(host, 'selfRenderContainer'),
		'handleMouse',
		event,
	)
}
