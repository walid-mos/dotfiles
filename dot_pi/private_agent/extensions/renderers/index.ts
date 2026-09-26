/** renderers - assistant responses, every Pi tool output, compaction cards,
 * framed user prompts and skill callouts.
 * install-renderers.ts owns the runtime lifecycle; *-surface.ts isolate the Pi ABI.
 * prompt-surfaces.ts composes the user-side patches (prompt-block.ts,
 * skill-block.ts, surfaces.ts, attachment-surface.ts, runtime.ts).
 * tool-row.ts owns row state, tool-presentation.ts tool vocabulary, tool-details.ts
 * native expanded content. tool-changes.ts composes inline mutation previews;
 * write-snapshots.ts observes bounded before-images without modifying execution. response-message.ts classifies response sections; assistant-surface.ts
 * mounts them. Shared activity layout, response dividers/Markdown and clocks live in ui/.
 * No tool registrations or execution wrappers: current, late-loaded and replayed tools
 * all cross the same display adapter. DESIGN.md records scope and upgrade checks. */
import { detectPiDrift, loadPiRuntime } from '../ui/pi-runtime.ts'
import { showRendererDrift } from '../ui/renderer-drift.ts'

import { installRenderers } from './install-renderers.ts'
import { installPromptSurfaces } from './prompt-surfaces.ts'
import { WriteSnapshots } from './write-snapshots.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export default async function renderers(pi: ExtensionAPI): Promise<void> {
	const runtime = await loadPiRuntime()
	const drift = detectPiDrift(runtime)
	let dispose = installRenderers(runtime)
	const disposePrompts = await installPromptSurfaces()
	const writes = new WriteSnapshots()
	pi.on('tool_call', async (event, context) => {
		if (context.hasUI && event.toolName === 'write')
			await writes.capture(event.toolCallId, event.input, context.cwd)
	})
	pi.on('tool_execution_end', event => {
		if (event.toolName === 'write') writes.complete(event)
	})
	pi.on('agent_end', () => writes.clear())
	pi.on('session_start', (_event, context) => {
		dispose = installRenderers(runtime)
		if (drift.drifted) showRendererDrift(context.ui, drift)
	})
	pi.on('session_shutdown', () => {
		writes.clear()
		dispose()
		disposePrompts()
	})
}
