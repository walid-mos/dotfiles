---
name: plane
description: >-
    Full Plane (project management) access over its REST API with curl + jq —
    no MCP. Use for ANY Plane task: list/search/create/update/close issues,
    comments, reactions, labels, states, modules, cycles, pages, members on the
    `nextnode` workspace (api.plane.so). Use for Plane requests, nextnode
    Plane tickets/backlogs/sprints, or identifiers such as STYLOT-…; an
    explicitly Linear or Jira ticket does not route here.
---

# Plane — REST API skill

Plane cloud, workspace `nextnode`. All access is plain `curl` + `jq`; never use
an MCP for this.

## Setup

- Base URL: `https://api.plane.so/api/v1`
- Auth: `curl -H "X-API-Key: $PLANE_API_KEY" …` — the key is already in the
  session env. **Never echo, log, or commit the key value.**
- Workspace slug: `nextnode`. Prefix every route with it:
  `W=https://api.plane.so/api/v1/workspaces/nextnode`

## Response envelope & pagination

Every collection returns one envelope:

```json
{"results": [ … ], "total_count": n, "count": n, "total_pages": n,
 "next_cursor": "50:1:0", "prev_cursor": "…", "next_page_results": true}
```

- Read items from `.results`, totals from `.total_count`.
- Explicitly pass `?per_page=50` (default page is small); when
  `.next_page_results` is true, fetch the next page with
  `&cursor=<next_cursor>` until it is false.
- `members/` returns a bare array, not an envelope.

## Resolve a project first

Issue routes need the project **UUID**, never its slug. Resolve by name or
identifier (e.g. STYLOT):

```bash
curl -s -H "X-API-Key: $PLANE_API_KEY" "$W/projects/?per_page=50" \
  | jq -r '.results[] | "\(.id)  \(.identifier)  \(.name)"'
```

## Common recipes

All snippets use `W=…`, `P=<project uuid>`, `K=X-API-Key: $PLANE_API_KEY`.

```bash
# Issues (filter with ?state=, ?assignee=, ?label=, ?priority=, ?search=seq-or-text, ?target_date=)
curl -s -H "$K" "$W/projects/$P/issues/?per_page=50" | \
  jq -r '.results[] | "\(.sequence_id)\t\(.name)\t\(.state__name // "state name pending lookup")\t\(.priority)"'

# One issue (id → detail, includes description_html)
curl -s -H "$K" "$W/projects/$P/issues/$ISSUE_ID/"

# Comments
curl -s -H "$K" "$W/projects/$P/issues/$ISSUE_ID/comments/"

# States (id → name mapping), labels, members, modules, cycles, pages
curl -s -H "$K" "$W/projects/$P/states/" | jq -r '.results[] | "\(.id)\t\(.name)"'
```

Build an id→name map once per task (states, labels, members) and translate ids
before presenting anything to the user — never show raw UUIDs. In the issue-list
example, a missing `state__name` is a lookup still to perform, not a display
value for the final report.

## Writes

POST/PATCH JSON bodies; PATCH is partial (send only changed fields):

```bash
# Create an issue (state: pass a state UUID; priority: urgent|high|medium|low|none)
curl -s -X POST -H "$K" -H "Content-Type: application/json" \
  -d '{"name":"Fix login loop","state":"<state-uuid>","priority":"high",
       "assignees":["<member-uuid>"],"labels_ids":["<label-uuid>"]}' \
  "$W/projects/$P/issues/"

# Rename / close an issue
curl -s -X PATCH -H "$K" -H "Content-Type: application/json" \
  -d '{"name":"New title"}' "$W/projects/$P/issues/$ISSUE_ID/"

# Comment on an issue
curl -s -X POST -H "$K" -H "Content-Type: application/json" \
  -d '{"comment_html":"<p>Looks fixed on staging.</p>"}' \
  "$W/projects/$P/issues/$ISSUE_ID/comments/"
```

`Content-Type: application/json` is required on every write.

## Safety

- Never DELETE, and never PATCH away real content, without an explicit user
  request naming the target.
- Batch edits: loop with the cursor pagination, one PATCH per issue, and report
  the count — never claim success for pages you did not fetch.

## Quirks

- `issue-types/` returns 402 (paid plan) — do not retry it.
- There is no workspace-level issue list: always go through a project.
- Error bodies are `{"error": "…", "error_code": n}` — surface the message,
  not just the HTTP code.

## Full endpoint catalog

For routes not shown above (reactions, sub-issues, links, attachments, cycles
and module membership, page content, intake, webhooks), read
[endpoints.md](endpoints.md) — it extends this file and is single-homed.
