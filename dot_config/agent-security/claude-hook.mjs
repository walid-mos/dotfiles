import { readFileSync } from 'node:fs'

import { secretAccessRefusal } from './secret-policy.ts'

try {
	const request = JSON.parse(readFileSync(0, 'utf8'))
	if (typeof request.tool_name !== 'string' || !request.tool_input)
		throw new Error('Invalid hook input')
	const reason = secretAccessRefusal(request.tool_name, request.tool_input)
	if (reason) {
		process.stdout.write(
			JSON.stringify({
				hookSpecificOutput: {
					hookEventName: 'PreToolUse',
					permissionDecision: 'deny',
					permissionDecisionReason: reason,
				},
			}),
		)
	}
} catch {
	process.stderr.write(
		'Secret guard could not validate the call. Tool execution blocked.\n',
	)
	process.exitCode = 2
}
