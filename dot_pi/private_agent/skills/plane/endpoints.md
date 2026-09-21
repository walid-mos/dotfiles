# Plane endpoint catalog

Extends `SKILL.md` (setup, envelope, project resolution, write/safety rules are
not restated here). All routes below are relative to
`$W = https://api.plane.so/api/v1/workspaces/nextnode`.
`$P` = project UUID, `$I` = issue UUID. Verify a route with a GET before a
write; if a route 404s on this instance, fall back to the web UI instead of
guessing variants.

## Project-scoped collections

| Route | Purpose |
|---|---|
| `projects/` | list / create / update projects (`POST`, `PATCH projects/<id>/`) |
| `projects/$P/issues/` | list (filters: `state`, `assignee`, `label`, `priority`, `search`, `target_date`, `state_group`, `created_by`), create |
| `projects/$P/issues/$I/` | detail / update / delete |
| `projects/$P/issues/$I/comments/` | list / create (`comment_html`) |
| `projects/$P/issues/$I/comments/<cid>/` | update / delete a comment |
| `projects/$P/issues/$I/activities/` | read-only activity feed |
| `projects/$P/issues/$I/reactions/` | list / create (`{"reaction":"👍"}`) |
| `projects/$P/issues/$I/labels/` | attach labels to an issue |
| `projects/$P/issues/$I/sub-issues/` | sub-issue tree (also `?sub_issues=true` on detail) |
| `projects/$P/issues/$I/links/` | list / create external links (`{"url","title"}`) |
| `projects/$P/issues/$I/attachments/` | list / upload (`multipart/form-data`, field `file`) |
| `projects/$P/labels/` | label CRUD (`name`, `color` hex) |
| `projects/$P/states/` | state CRUD (`name`, `group` = backlog\|unstarted\|started\|completed\|cancelled) |
| `projects/$P/members/` | project members (bare array) |
| `projects/$P/modules/` | module CRUD (`name`, `status` = backlog\|planned\|in-progress\|paused\|completed) |
| `projects/$P/modules/<mid>/issues/` | list / add (`issues` = [uuid]) / remove issues in a module |
| `projects/$P/cycles/` | cycle CRUD (`name`, `start_date`, `end_date` YYYY-MM-DD) |
| `projects/$P/cycles/<cid>/cycles/` | cycle auto-management (children cycles) |
| `projects/$P/cycles/<cid>/cycle-issues/` | list / add / remove issues in a cycle (`issues` = [uuid]) |
| `projects/$P/pages/` | page CRUD (`name`, `description_html`) |
| `projects/$P/pages/<pid>/` | page detail; `description_html` is plain prose markup |
| `projects/$P/intake/` | intake (inbox) issues — triage queue |

## Workspace-scoped

| Route | Purpose |
|---|---|
| `projects/` | all projects of the workspace |
| `states/` | every state of the workspace (envelope) |
| `users/me/` | the API key's own user |
| `projects/$P/members/` | (above) — use this for assignee resolution; no workspace member list route |

## Body-shape notes

- Issue create/update accepts: `name`, `description_html`, `priority`,
  `state` (uuid), `assignees` [member uuid], `labels_ids` [label uuid],
  `start_date`, `target_date`, `parent` (issue uuid, for sub-issues),
  `estimate` (uuid, if estimates enabled).
- Comment text must be HTML: plain text works inside `<p>…</p>`.
- Reactions accept a single emoji glyph in `reaction`.
- Bulk create: `POST projects/$P/issues/` with
  `{"issues":[{…},{…}]}` to `projects/$P/issues/bulk/` — verify against the
  response, which returns per-item success/failure maps.

## Reading discipline

- Always `?per_page=50` + cursor loop (see `SKILL.md`); never present one page
  as the full list.
- Dates are ISO 8601 UTC (`2026-07-24T16:41:35Z`).
