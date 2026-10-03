---
name: to-issue
description: Turn an audit finding, bug, or task into a fully-specified issue and create it directly on Linear (nextnode workspace, via the Linear MCP). Use when the user asks to file or send an issue ("to-issue", "crée une issue", "transforme ça en ticket", "mets ça sur linear", "file this as an issue").
---

# to-issue — file a fully-specified issue on Linear

The filing mechanics (auth, reads, mutations) come from the Linear MCP and,
for operations it lacks, the `linear-api` skill (`~/.pi/agent/skills/linear-api/SKILL.md`).
This skill owns the **spec discipline**: what a complete issue contains before
it is created.

Never route to Linear when the user explicitly names a Jira ticket — Jira goes
through the `jira` MCP server.

## Spec the issue before filing

Resolve each element against the conversation evidence (finding, files read,
commands run). Never invent facts; "unknown" is a valid value.

**Title** — ≤ 100 chars, imperative, no team prefix (Linear assigns the
identifier like `ENG-123`). Name the behavior, not the file:
`Menu compliance silently drops dishes without allergen data`, not `Fix bug in compliance.ts`.

**Team / project** — ask the user only when the conversation does not make it
obvious; otherwise discover with `mcp_list_teams` and existing issues from the
same context (`mcp_list_issues` with a `query`). Never guess a team ID.

**Description body** — four blocks, in this order, only the ones that carry content:

1. **Context** — one to three sentences: what was being done or audited when the
   finding surfaced.
2. **Finding / evidence** — the concrete observation: file paths with line
   numbers, commands, numbers, error output. For a bug: repro steps (numbered).
3. **Expected vs actual** — one line each, or a single line when trivially implied.
4. **Acceptance criteria** — numbered, each independently checkable, phrased as
   an observable outcome. Omit only for pure information tickets.

**Fields** — set what is known, omit what is not:

- `priority`: only when the user states it or the finding's severity is unambiguous
  (regression in production > 2; broken flow, no workaround > 3; polish > 0).
- `labels`: match against existing labels (`mcp_list_issue_labels`) before
  creating one; never create a label to file one issue.
- `assignee`, `project`, `parent`: only when the user names them or an obvious
  parent issue exists (e.g. the audit's umbrella ticket).

## Filing

1. Reads first (teams, labels, statuses) through the Linear MCP.
2. Create with `mcp_save_issue` — `team` and `title` required; pass the
   description as Markdown.
3. Report back the returned identifier and URL in one line. Do not restate the body.

## Related skills

- `linear-api` — epic/milestone routing, and GraphQL for operations the Linear MCP lacks.
