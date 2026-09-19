/**
 * tool-scope - pay for a tool's schema only once the session asks for it.
 *
 * Every registered extension tool is active by default, so its full schema sits
 * in the prompt on every turn, including the turns that never call it. Measured
 * on 2026-09-18 (`node audits/harness-footprint.ts`), 7.9k of a 15.9k
 * per-session floor was exactly that: the subagent tool (4.1k), the four
 * pi-web-access tools (2.8k) and bg_wait (1.1k).
 *
 * This extension owns the session's own tool list. At session start it applies
 * the plan from `policy.ts` - `defer` tools leave the prompt but come back the
 * moment `load_tools` activates them, `off` tools are gone for good - so a
 * session pays for what it uses, and delegation, search or a background wait
 * cost one extra call instead of a per-turn schema.
 *
 * Scope: sessions with a UI - interactive (`tui`) and host-driven (`rpc`) alike.
 * Headless runs (`print`, `json`) and granted child sessions keep the set their
 * caller chose, so a subagent child can never lose a tool it was granted;
 * `pi --exclude-tools ...` stays the lever there.
 *
 * Modules:
 *   policy.ts - pure: config parsing, the defer/off plan, loader texts
 *
 * Config: `<agentDir>/tool-scope.json`, optional, read once per session:
 *   {
 *     "defer": ["subagent", "web_search"],          // replaces the defaults
 *     "off": ["frontend_open"],                     // never available here
 *     "projects": {                                 // additive, by cwd prefix
 *       "/Users/me/Development/tools/pi-web-access": { "off": ["web_search"] }
 *     }
 *   }
 * Absent file -> the measured defaults above. An absent list falls back to the
 * default, never to "no tools": only an explicit `[]` clears one.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { getAgentDir } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

import {
	activationReport,
	loaderDescription,
	parseConfig,
	resolveActivation,
	resolvePlan,
} from './policy.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { ScopePlan, ToolScopeConfig } from './policy.ts'

/** The always-on tool that brings deferred schemas back. */
const LOADER_NAME = 'load_tools'
const CONFIG_FILE = 'tool-scope.json'

/** The session's config; a missing or unreadable file means the defaults. */
function loadConfig(): ToolScopeConfig {
	try {
		const raw: unknown = JSON.parse(
			readFileSync(join(getAgentDir(), CONFIG_FILE), 'utf8'),
		)
		return parseConfig(raw)
	} catch {
		return parseConfig(undefined)
	}
}

/** Register the loader for this session's held-back set. */
function registerLoader(
	pi: ExtensionAPI,
	pending: Set<string>,
	disabled: string[],
): void {
	pi.registerTool({
		name: LOADER_NAME,
		label: 'Load Tools',
		description: loaderDescription([...pending]),
		promptSnippet:
			'Activate a tool this session started without (web search, subagent, background waits)',
		promptGuidelines: [
			`Use load_tools to activate a tool before calling it: ${[...pending].join(', ')} start inactive to keep the prompt small.`,
		],
		parameters: Type.Object({
			names: Type.Array(Type.String(), {
				description: 'Names of the tools to activate now.',
			}),
		}),
		execute: async (_toolCallId, params) => {
			const outcome = resolveActivation(
				params.names,
				[...pending],
				disabled,
			)
			for (const name of outcome.activated) pending.delete(name)
			if (outcome.activated.length > 0) {
				// Additive only: pi applies the change before the next request.
				pi.setActiveTools([
					...new Set([...pi.getActiveTools(), ...outcome.activated]),
				])
			}
			return {
				content: [
					{
						type: 'text' as const,
						text: activationReport(outcome, [...pending]),
					},
				],
				details: {
					activated: outcome.activated,
					disabled: outcome.disabled,
					unknown: outcome.unknown,
					pending: [...pending],
				},
			}
		},
	})
}

function applyScope(pi: ExtensionAPI, plan: ScopePlan): void {
	if (!plan.deferred.length && !plan.disabled.length) return
	const pending = new Set(plan.deferred)
	if (pending.size > 0) registerLoader(pi, pending, plan.disabled)
	const keep = pending.size > 0 ? [...plan.keep, LOADER_NAME] : plan.keep
	pi.setActiveTools([...new Set(keep)])
}

export default function toolScope(pi: ExtensionAPI): void {
	pi.on('session_start', (_event, ctx) => {
		if (!ctx.hasUI) return
		const active = pi.getActiveTools()
		applyScope(pi, resolvePlan(loadConfig(), ctx.cwd, active))
	})
}
