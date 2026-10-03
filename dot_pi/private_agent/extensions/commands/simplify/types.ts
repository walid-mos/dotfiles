/** Shared domain types for the /simplify pipeline: scope, findings, gates. */

export interface LineRange {
	start: number
	end: number
}

export type ScopeMode =
	| { kind: 'worktree' }
	| { kind: 'staged' }
	| { kind: 'last' }
	| { kind: 'ref'; ref: string }
	| { kind: 'target'; query: string }
	| { kind: 'snapshot'; paths: string[] }

export interface ScopeRequest {
	mode: ScopeMode
	paths: string[]
	focus?: string
}

export type ScopeStatus =
	| 'added'
	| 'modified'
	| 'renamed'
	| 'copied'
	| 'untracked'

export interface ScopeFile {
	path: string
	status: ScopeStatus
	/** True when the whole file is in scope (added or untracked). */
	wholeFile: boolean
	ranges: LineRange[]
	/** Content identity captured at scope time; re-checked before any edit. */
	hash: string
}

export interface SkippedFile {
	path: string
	reason: string
}

export interface ScopeManifest {
	workspaceRoot: string
	source: 'git' | 'files'
	/** Human label for the resolved scope, shown in notices. */
	label: string
	files: ScopeFile[]
	skipped: SkippedFile[]
	/** The command that reproduces the analysed diff; absent for direct files. */
	diffCommand?: string
}

export type Lens = 'reuse' | 'quality' | 'efficiency' | 'solid'

export type Risk = 'safe' | 'confirm' | 'review'

export type FindingAction =
	| 'delete'
	| 'inline'
	| 'refactor'
	| 'parallelize'
	| 'rename'

export interface Finding {
	file: string
	lines: string
	risk: Risk
	action: FindingAction
	/** One-clause readable name, shown in lists; rootIssue is the full story. */
	title: string
	rootIssue: string
	consequence: string
	benefit: string
	evidence: string
}

export interface MergedFinding extends Finding {
	/** Stable 1-based identity inside one run's merged list. */
	id: number
	lenses: Lens[]
}

export interface StaleFinding {
	finding: MergedFinding
	reason: string
}

export interface LensFailure {
	lens: Lens
	reason: string
}

export interface AnalysisOutcome {
	/** In-scope findings, deduplicated, highest risk first. */
	findings: MergedFinding[]
	/** Out-of-scope observations; never applied. */
	notes: string[]
	/** Lens results that were missing or unusable. */
	failures: LensFailure[]
}

export interface Gate {
	label: string
	command: string
	/** A suite that takes minutes: ask before running it. */
	long?: boolean
}
