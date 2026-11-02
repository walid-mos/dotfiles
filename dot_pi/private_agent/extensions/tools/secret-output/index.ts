/** Rejects cleartext secret output without blocking masked MCP calls or CLI injection and writes. */
import { secretAccessRefusal } from '../../../../../.config/agent-security/secret-policy.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export default function secretOutputGuard(pi: ExtensionAPI): void {
	pi.on('tool_call', event => {
		const reason = secretAccessRefusal(event.toolName, event.input)
		if (!reason) return undefined
		return { block: true, reason }
	})
}
