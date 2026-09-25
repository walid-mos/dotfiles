# MCP gaps — Linear operations absent from the Linear MCP

Extends "Rule: MCP first, this skill for the gaps" and the mutation protocol in `SKILL.md`; the
core rules are not restated here. This file adds the concrete operation inventory and mutation
recipes for the operations the Linear MCP (server `mcp`) does not expose but the GraphQL API does,
keyed on `LINEAR_API_KEY`.

Every recipe below is a starting point: **verify mutation names and input fields against the live
schema before the first write** — Linear's GraphQL API is unversioned and changes with the
`[API]` changelog. Team, workflow-state, webhook, and membership mutations require an admin
user's API key.

Verify a type (adjust the type name; list candidates with `__type(name: "Mutation")` filtered by
your needs if a name fails):

```bash
scripts/linear raw 'query { __type(name: "TeamUpdateInput") { inputFields { name type { name kind ofType { name } } } } }' --json
```

## Operation inventory: MCP vs API

| Operation | Linear MCP | This skill |
|---|---|---|
| Read teams / members / states | yes (`mcp_list_teams`, `mcp_list_issue_statuses`) | `team list`, `state list` |
| Create / update / delete a team | **no** | `teamCreate`, `teamUpdate`, `teamDelete` |
| Create / update / delete a workflow state | **no** | `workflowStateCreate`, `workflowStateUpdate`, `workflowStateDelete` |
| Team memberships (add/remove users, owner flag) | **no** | `teamMembershipCreate`, `teamMembershipDelete` |
| Webhooks (create, update, delete) | **no** | `webhookCreate`, `webhookUpdate`, `webhookDelete` |
| Issues, projects, comments, cycles, labels, attachments, documents | yes | do not duplicate |
| Anything else (invitations, org settings, integrations, API-token admin) | **no** | discover via `raw` + introspection |

## Teams

```bash
# Create (name and key required; key is the short uppercase identifier, e.g. ENG)
scripts/linear raw 'mutation($input: TeamCreateInput!) { teamCreate(input: $input) { success team { id name key } lastSyncId } }' \
  --variables '{"input": {"name": "Data", "key": "DATA"}}' --confirm --json

# Update (id from `team list`; partial input, only changed fields)
scripts/linear raw 'mutation($id: String!, $input: TeamUpdateInput!) { teamUpdate(id: $id, input: $input) { success team { id name key } } }' \
  --variables '{"id": "TEAM-UUID", "input": {"name": "Data Platform"}}' --confirm --json

# Delete (irreversible: team issues are archived — confirm the rollback plan with the user first)
scripts/linear raw 'mutation($id: String!) { teamDelete(id: $id) { success } }' \
  --variables '{"id": "TEAM-UUID"}' --confirm --json
```

## Workflow states

`type` must be one of `triage`, `backlog`, `unstarted`, `started`, `completed`, `canceled`; a team
usually keeps at most one state per type except `started`. `position` orders states in the UI.

```bash
scripts/linear raw 'mutation($input: WorkflowStateCreateInput!) { workflowStateCreate(input: $input) { success workflowState { id name type } } }' \
  --variables '{"input": {"teamId": "TEAM-UUID", "name": "In Review", "type": "started", "color": "#5e6ad2", "position": 300}}' --confirm --json

scripts/linear raw 'mutation($id: String!, $input: WorkflowStateUpdateInput!) { workflowStateUpdate(id: $id, input: $input) { success workflowState { id name type } } }' \
  --variables '{"id": "STATE-UUID", "input": {"name": "Review"}}' --confirm --json
```

Do not delete a state that still holds issues: move issues to another state first (or use
`workflowStateDelete` only after `state list` shows an empty transition plan).

## Team memberships

```bash
# Add a user to a team (user id from `mcp_list_users` or an introspected `users` query; owner grants triage rights)
scripts/linear raw 'mutation($input: TeamMembershipCreateInput!) { teamMembershipCreate(input: $input) { success lastSyncId } }' \
  --variables '{"input": {"teamId": "TEAM-UUID", "userId": "USER-UUID"}}' --confirm --json

# Remove: look up the membership id first
scripts/linear raw 'query($teamId: String!, $userId: String!) { team(id: $teamId) { memberships(filter: {user: {id: {eq: $userId}}}) { nodes { id user { name } } } } }' \
  --variables '{"teamId": "TEAM-UUID", "userId": "USER-UUID"}' --json
```

## Webhooks

`resourceType` values mirror Linear's data model (e.g. `Issue`, `Comment`, `Project`,
`Initiative`, …) or `AllApplicationWebhooks` for everything; narrow to a team with `teamIds` when
possible. The target URL must be HTTPS and reachable from Linear's egress.

```bash
scripts/linear raw 'mutation($input: WebhookCreateInput!) { webhookCreate(input: $input) { success webhook { id targetUrl } lastSyncId } }' \
  --variables '{"input": {"targetUrl": "https://example.com/hooks/linear", "resourceType": "Issue", "label": "sync-to-backend"}}' --confirm --json
```

Webhook payloads are signed: verify the `Linear-Signature` HMAC-SHA256 header with the webhook's
signing secret (Linear → Settings → API → Webhooks) before trusting deliveries.

## Discovering a gap not listed here

Run introspection against `Mutation` and grep the field list for the operation's domain, then
introspect the matching `*Input` type as shown at the top:

```bash
scripts/linear raw 'query { __type(name: "Mutation") { fields { name } } }' --json
```
