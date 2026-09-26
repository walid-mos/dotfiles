---
name: to-issue
description: Turn an audit finding, bug, or task into a fully-specified issue and create it directly on the nextnode Plane workspace (api.plane.so). Use when the user asks to file or send an issue ("to-issue", "crée une issue plane", "transforme ça en ticket", "mets ça sur plane", "file this as an issue").
---

# to-issue — file a fully-specified issue on Plane

API key handling and REST mechanics (routes, response envelope, pagination, write
safety) live in `~/.pi/agent/skills/plane/SKILL.md` — read it before any call.
This skill adds only the issue spec format and the creation workflow.

## Workflow

1. **Resolve the project** (UUID required, by identifier): `FITAPP`, `INFRA`,
   `STYLOT`, `MINA`, `MIZRAJ`. Infer it from the current repo's git remote when
   the cwd gives one (fitapp → FITAPP, core → INFRA). If the cwd does not map or
   the user names another repo, narrow the candidates using repository evidence
   and ask once with two or three choices, including “other project” when needed.
2. **Resolve the start state UUID in THAT project** (usually `Todo`) via the
   project's `states/` endpoint. State ids are per-project: reusing another
   project's UUID fails with `400 "State is not valid please pass a valid
   state_id"`.
3. **Draft the issue** (spec below), create it, report.

## Issue spec — the deliverable

An issue must be actionable by a future agent with no other context than its own
description. No "see conversation", no pronouns without referents, no invented
pointers.

**Title** — ≤ 100 chars, no project prefix (Plane numbers it); an optional scope
tag is fine (`Auth: …`, `CI: …`). State the defect, not the task verb.

**Priority** — `high` (breaks users or blocks another issue), `medium` (reliability
or process gap), `low` (cleanup, cosmetic, investigate-then-decide).

**`description_html`** — plain HTML, six sections in this order. Mandate each,
drop a section only when truly empty:

```html
<h3>Problem</h3>
<p>Observed behavior + who/what it breaks. One fact per sentence.</p>
<h3>Root cause</h3>
<ul>
  <li><code>path/to/file.ts:LINE</code> → one-line explanation.</li>
</ul>
<h3>Fix spec</h3>
<ol>
  <li>Ordered, concrete steps: exact file, exact change, exact command.</li>
</ol>
<h3>Acceptance criteria</h3>
<ul>
  <li>☐ Observable outcome (test case name, HTTP result, UI flow).</li>
</ul>
<h3>Out of scope</h3>
<p>Explicitly excluded adjacent work, with the related issue reference if it exists.</p>
<h3>References</h3>
<p>Commits, run ids, PR numbers, doc URLs — only real evidence.</p>
```

Rules that make the spec fixable:

- **Read the code before writing Root cause.** Point at real `file:line` from the
  actual repo state; never invent line numbers. If the cause is unproven, write it
  as a hypothesis inside a first "Investigation spec" ordered list and make
  "record the outcome" the first acceptance criterion.
- **Acceptance criteria are observable outcomes**, not restatements of the fix:
  name the test file and case, the endpoint and expected status, or the user flow.
  One ☐ per check, keep them independently verifiable.
- **Fix or close explicitly**: when the resolution could be either "fix it" or
  "remove it with an explanatory commit", write both closure paths as separate
  criteria — the agent picks one with cause documented.
- Escape `&` and `<` inside `<code>` snippets; keep snippets ≤ 10 lines (link to
  the file for more).
- Scope one intention per issue; if two fixes are independent, file two issues and
  cross-reference them.

## Creation mechanics

- Build the payload as a JSON file with the `write` tool (`{"name", "state",
  "priority", "description_html"}`), then POST it with `curl -d @file` — never
  inline the HTML in the shell command.
- Expect `sequence_id` and `id` in the response; on `400`, surface the error body
  (it names the offending field).
- Report to the user: `IDENT-<sequence_id>` · priority · title · project.

Do not add labels, assignees, epic or module links unless the user asked — note in
the final report that they can be added on request.
