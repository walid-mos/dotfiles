# Plans home (`~/.pi/agent/plans`)

Long-lived planning artifacts: roadmaps, multi-phase build plans, migrations, design docs that
span several sessions. One plan = one self-contained, status-tagged markdown file owned by a
project. **Single source of truth for these conventions is this README — never copy them into
AGENTS.md or anywhere else.**

`plans/` is **not** for: session notes, quick TODOs (→ the session), repo code docs (→ the
repo), mission state (→ pi missions).

## Structure

```
plans/
├── README.md                     # these conventions (read before touching anything here)
├── INDEX.md                      # the discovery surface — a plan without a row does not exist
├── templates/plan.md             # start every new plan from here, never freehand
├── active/<project-slug>/<plan-name>.md   # living plans, one subdir per project
└── done/<year>/<plan-name>.md    # closed plans, stored by year, dirs moved whole
```

## Rules

1. Create from `templates/plan.md`; keep the front matter (id/title/project/status/created/updated) exact.
2. Identity = `<project-slug>/<plan-name>` (equals the front-matter id). Never rename an indexed plan.
3. English; imperative; self-contained — a reader with no chat history must understand it.
4. Format is prescriptive in the template (**telegraphic** — grammar sacrificed for concision;
   **diagram-first** — one Mermaid flowchart drawn before any prose structure of the change;
   tables only for enumerable data; plan ends with Open questions then Steps). Never freehand.
5. Update `status` and `updated` in the front matter AND the INDEX row on every significant edit
   (`draft → active → review → done`).
6. While executing a plan, write probe results, decisions and gate outcomes into the plan itself
   (dated sections) — not into chat-only summaries.
7. Closing a plan: front matter `status: done` → move the **project subdir** under `done/<year>/`
   → update the INDEX row.
8. Moving a plan (any reason): update INDEX, then `rg` the old path across
   `~/.pi/agent/AGENTS.md`, `~/.config/zsh/`, `~/.pi/agent/extensions/` and fix every reference —
   a plan behind a dead path is lost for readers.
9. Keep it tidy: one project → one subdir → few files. A plan sprawl is a smell: split by goal,
   not by date.
10. Context hygiene: `done/` is archive — for humans and explicit audits only, never working
   context. Default to zero reads of archived plans: INDEX is enough for discovery. Load a done
   plan ONLY when the user explicitly asks, or the task demonstrably needs the history — and
   then only that one plan, never a folder sweep.
