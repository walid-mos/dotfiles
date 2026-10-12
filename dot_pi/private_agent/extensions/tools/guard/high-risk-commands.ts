/**
 * High-risk command gate.
 *
 * Merges, protected-ref pushes, production deploys and remote writes run only
 * with a live single-use grant the operator mints through the /authorize
 * command (human-confirmed). Grants live as session entries the agent cannot
 * write; the gate restores them with the branch exactly like the read ledger.
 */
export const HIGH_RISK_GRANTS_ENTRY = 'pi-high-risk-grants-v1'

export const GRANT_KINDS = ['merge', 'push', 'deploy', 'remote-write'] as const

export type GrantKind = (typeof GRANT_KINDS)[number]

const GRANT_ROW_FIELDS = 3

/** Entry row shape: [kind, detail-or-empty, grantedAtMs]. Strings only, no optionals. */
type GrantRow = [GrantKind, string, number]

interface HighRiskHit {
	kind: GrantKind
	label: string
}

const PATTERNS: { kind: GrantKind; test: RegExp; label: string }[] = [
	{ kind: 'merge', test: /\bgh\s+pr\s+merge\b/, label: 'gh pr merge' },
	{
		kind: 'merge',
		test: /\bgh\s+api\b[^&|;\n]*(\/merges\b|\/merge\b)/,
		label: 'gh api merge endpoint',
	},
	{
		kind: 'push',
		test: /\bgit\s+push\b[^&|;\n]*\b(--force\b|-[a-zA-Z]*f[a-zA-Z]*[^a-zA-Z-])/,
		label: 'force push',
	},
	{
		kind: 'push',
		test: /\bgit\s+push\b[^&|;\n]*\s[:][A-Za-z][\w/-]*/,
		label: 'destructive push refspec',
	},
	{
		kind: 'push',
		test: /\bgit\s+push\b[^&|;\n]*\b--delete\b/,
		label: 'branch deletion push',
	},
	{
		kind: 'push',
		test: /\bgit\s+push\b[^&|;\n]*\b(?:main|master|prod|production)\b/,
		label: 'push to protected branch',
	},
	{
		kind: 'push',
		test: /\bgit\s+push\b[^&|;\n]*\b(--all\b|--mirror\b)/,
		label: 'push all refs',
	},
	{
		kind: 'deploy',
		test: /\bwrangler\s+(deploy\b|versions\s+upload\b|pages\s+deploy\b)/,
		label: 'wrangler deploy',
	},
	{
		kind: 'deploy',
		test: /\bvercel\b[^&|;\n]*--prod\b/,
		label: 'vercel prod',
	},
	{ kind: 'deploy', test: /\bfly(ctl)?\s+deploy\b/, label: 'fly deploy' },
	{ kind: 'deploy', test: /\bterraform\s+apply\b/, label: 'terraform apply' },
	{
		kind: 'deploy',
		test: /\bsupabase\s+db\s+push\b/,
		label: 'supabase db push',
	},
	{
		kind: 'deploy',
		test: /\bgh\s+workflow\s+run\b/,
		label: 'gh workflow run',
	},
	{
		kind: 'remote-write',
		test: /\bwrangler\b[^&|;\n]*--remote\b/,
		label: 'wrangler remote write',
	},
	{
		kind: 'remote-write',
		test: /\bgh\s+api\b[^&|;\n]*-X\s+(POST|PUT|PATCH|DELETE)\b/,
		label: 'gh api mutation',
	},
]

const GRANT_KIND_STRINGS: readonly string[] = GRANT_KINDS

export function isGrantKind(candidate: unknown): candidate is GrantKind {
	return (
		typeof candidate === 'string' && GRANT_KIND_STRINGS.includes(candidate)
	)
}

/** Scan one command line (or its serialized parameters) for a high-risk hit. */
export function scanHighRisk(text: string): HighRiskHit | undefined {
	for (const pattern of PATTERNS) {
		if (pattern.test.test(text))
			return { kind: pattern.kind, label: pattern.label }
	}
	return undefined
}

export const AUTHORIZATION_USAGE =
	'Usage: /authorize merge|push|deploy|remote-write [qualifier] - single-use grant for one high-risk call in this task.'

function hasMatchedDetail(detail: string, text: string): boolean {
	return !detail || text.toLowerCase().includes(detail.toLowerCase())
}

function isGrantRow(row: unknown): row is GrantRow {
	if (!Array.isArray(row) || row.length !== GRANT_ROW_FIELDS) return false
	const [kind, detail, atMs] = row
	return (
		isGrantKind(kind) &&
		typeof detail === 'string' &&
		typeof atMs === 'number'
	)
}

/** Operator-minted single-use grants, restored through session entries. */
export class HighRiskGate {
	private readonly grants: HighRiskGrant[] = []

	restore(snapshot: unknown): void {
		this.grants.length = 0
		if (!Array.isArray(snapshot)) return
		for (const row of snapshot) {
			if (!isGrantRow(row)) continue
			const [kind, detail, atMs] = row
			this.grants.push({ kind, detail, atMs })
		}
	}

	snapshot(): GrantRow[] {
		return this.grants.map(grant => [grant.kind, grant.detail, grant.atMs])
	}

	add(kind: GrantKind, detail: string): void {
		this.grants.push({ kind, detail, atMs: Date.now() })
	}

	/** Allow the hit if a grant matches and consume that grant. */
	tryConsume(kind: GrantKind, text: string): boolean {
		const index = this.grants.findIndex(
			grant =>
				grant.kind === kind && hasMatchedDetail(grant.detail, text),
		)
		if (index === -1) return false
		this.grants.splice(index, 1)
		return true
	}
}

interface HighRiskGrant {
	kind: GrantKind
	detail: string
	atMs: number
}

export function highRiskBlockReason(hit: HighRiskHit): string {
	return `High-risk action blocked: ${hit.label} (${hit.kind}). Ask the operator to run /authorize ${hit.kind} [qualifier], then re-run the same call. The grant is single-use.`
}
