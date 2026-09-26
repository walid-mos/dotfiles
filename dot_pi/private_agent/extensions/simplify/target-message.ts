/** Hand a semantic /simplify request to the parent agent without guessing its scope. */

import path from 'node:path'

const AGENT_ROOT = path.resolve(import.meta.dirname, '..', '..')

export function buildTargetMessage(rawArgs: string, cwd: string): string {
	return [
		'## /simplify - interpret and execute the requested target',
		'',
		`Request: ${JSON.stringify(rawArgs.trim())}`,
		`Starting workspace: ${cwd}`,
		'',
		'The request is natural language, not a path to look up. Interpret its targets AND its directives before editing. First state an execution plan with each independent unit, its exact branch and checkout path, plus diff or file/line scope, the rules for that unit (including whether the user explicitly requested a commit), and how you will verify it. Resolve PRs from the repository rather than guessing their branches or bases. A request for only part of a branch must remain a changed-line subset, not a whole-directory snapshot.',
		'',
		'Execute every resolved unit separately in an existing checkout of its branch. Do not create a worktree or switch branches over uncommitted changes. If a branch has no available checkout, ask for a checkout path rather than changing another branch. Keep unrelated changes intact.',
		'',
		`For each unit, follow the /simplify pipeline: use the four read-only simplifier lenses (reuse, quality, efficiency, solid) on the resolved scope, merge and verify their evidence, apply only behaviour-preserving findings within that scope, apply provably safe Git-scoped findings automatically, and seek human approval for all other findings (including every direct-file finding). Run the project gates after edits. Read the authoritative lens and apply contracts in ${AGENT_ROOT}/extensions/simplify/lenses.ts, ${AGENT_ROOT}/extensions/simplify/apply.ts, and ${AGENT_ROOT}/agents/simplifier.md; do not substitute a broad cleanup pass. Report skipped findings and failed checks instead of silently dropping them.`,
		'',
		"The no-stage/no-commit line in apply.ts governs the deterministic pipeline; for this semantic request, an explicit commit directive overrides only that line after verification. Otherwise do not stage or commit. Commit on that unit's branch, stage only your own changes, use the existing Git identity and project commit conventions, and do not push unless asked. If a PR branch cannot be edited or a target is ambiguous, report the specific blocker and ask for a decision instead of choosing a different branch. Report the outcome separately for each unit.",
	].join('\n')
}
