---
name: linear-api
description: >-
  Linear workflow routing and direct GraphQL access for MCP gaps. Load for Linear epic requests:
  in the nextnode workspace, an epic is a project milestone, not an issue. Also load when a needed
  operation is absent from the Linear MCP tool list (team management, workflow states, webhooks,
  org-level admin, bulk mutations). Use the Linear MCP for ordinary issue, project, milestone,
  comment, cycle, label, attachment, and document work.
license: MIT (vendored script from magnus919/agent-skills, see SOURCE.md)
---

# Linear routing and API gaps

## Epic routing

In the connected nextnode workspace, **epic = project milestone**. For an epic request, find the
project and inspect its existing milestones, then create or update milestones with the Linear MCP's
`mcp_save_milestone`. Put implementation tasks in issues assigned to the milestone via
`mcp_save_issue.milestone`. Never represent an epic as an `[Epic]`-prefixed issue or a separate
project. Verify the milestones with `mcp_list_milestones` before reporting them.

## GraphQL operations absent from MCP

Use `scripts/linear` from this skill directory — a small, dependency-free wrapper around Linear's
public GraphQL API, not an MCP server. The Linear MCP handles everyday issue/project/milestone work;
this script exists for what the MCP does not expose. Load `references/mcp-gaps.md` before writing
any team, workflow-state, webhook, or membership mutation.

## Setup

1. Set `LINEAR_API_KEY` in the process environment only (personal API key from Linear → Settings →
   Security & access). Never print, persist, or place it in a command transcript.
2. Team, workflow-state, webhook, and membership mutations require an **admin** user's API key.
3. Start with `scripts/linear --help` and noun-level `--help` (e.g. `scripts/linear issue --help`);
   do not copy full command reference into responses.
4. Output is JSON (`--json` for compact). `--dry-run` previews without network or credentials.

## Rule: MCP first, GraphQL only for gaps

Epic routing above uses the Linear MCP. Before using the GraphQL script for any other operation,
confirm the operation is missing from the Linear MCP tool list (search with
`mcp({ search: "..." })`). If an MCP tool exists, use it. The script is not a parallel CLI for
already-covered nouns — duplicates drift.

## Mutations (including `raw`)

1. Discover the target with a read: use the available Linear MCP tools first (e.g.
   `mcp_list_teams`, `mcp_list_issue_statuses`); fall back to the script's read commands
   (`team list`, `state list --team ENG`, `whoami`) only when the MCP lacks that read.
2. State the exact intended change and the rollback path to the user.
3. Run the same command with `--dry-run --json` (no network, no credentials).
4. After confirmation, rerun with `--confirm --json`; report the returned id/outcome.

`raw` runs any GraphQL string; raw mutations require `--confirm`. Before trusting any mutation or
input field in `references/mcp-gaps.md`, verify it against the live schema:

```bash
scripts/linear raw 'query { __type(name: "TeamUpdateInput") { inputFields { name type { name kind ofType { name } } } } }' --json
```

Keep `raw` queries narrow; confirm field names in Linear's GraphQL documentation when unsure.

## Command map

| Need | Command |
|---|---|
| Confirm identity / admin status | Linear MCP if available, else `scripts/linear whoami --json` |
| List teams | `mcp_list_teams` first; else `scripts/linear team list --limit 20 --json` |
| List a team's workflow states | `mcp_list_issue_statuses` first; else `scripts/linear state list --team ENG --json` |
| Any MCP-gap operation (team, state, webhook, membership, …) | `scripts/linear raw 'mutation { … }' --confirm --json` |

Reads default to `--limit 10` (max 100); the CLI never auto-paginates.

## References

| When you need… | Load… |
|---|---|
| Recipes for operations the Linear MCP lacks | `references/mcp-gaps.md` |
| Endpoint, auth headers, pagination, errors, rate limits | `references/graphql-contract.md` |

## Errors and recovery

- Missing credentials: export `LINEAR_API_KEY` for the command session, or inspect with `--dry-run`.
- GraphQL error: the CLI writes Linear's first useful error to stderr and exits nonzero, even on
  HTTP 200 — check admin scope, exact ids, and schema fields.
- Ambiguity (team/state/label names): never guess ids; list first, use the exact value.
- Rate limit or transport failure: wait and retry the same bounded read; no retry loops.

## When not to use the GraphQL script

- Issue, project, milestone, comment, cycle, label, attachment, document CRUD → use the Linear MCP tools.
- Embedding a live agent inside Linear (agent sessions, webhooks as an agent) → Linear's Agent API.
