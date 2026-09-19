/** Bridge Pi's blocking UI prompt spans to Herdr's managed status reporter.
 * Pi coalesces nested prompts; this extension owns exactly one blocker and
 * releases it on dismissal or session teardown, never on agent settlement.
 * Socket transport and working/idle precedence remain owned by Herdr. */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export default function herdrPrompts(pi: ExtensionAPI): void {
	let isBlocked = false

	function releasePrompt(): void {
		if (!isBlocked) return
		isBlocked = false
		pi.events.emit('herdr:blocked', { active: false })
	}

	pi.on('ui_prompt_start', (_event, context) => {
		if (context.mode !== 'tui' || isBlocked) return
		isBlocked = true
		pi.events.emit('herdr:blocked', {
			active: true,
			label: 'Waiting for user input',
		})
	})
	pi.on('ui_prompt_end', releasePrompt)
	pi.on('session_shutdown', releasePrompt)
}
