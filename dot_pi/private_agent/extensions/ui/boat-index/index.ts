/**
 * Show the Boat index link below Pi's startup resource list.
 * The Boat launcher supplies the verified URL; local Pi has no link.
 */
import { hyperlink } from '@earendil-works/pi-tui'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export default function boatIndex(pi: ExtensionAPI): void {
	pi.on('session_start', (_event, context) => {
		const url = process.env.PI_BOAT_INDEX_URL
		if (context.mode !== 'tui' || !url) return
		context.ui.notify(`Workspace index: ${hyperlink(url, url)}`, 'info')
	})
}
