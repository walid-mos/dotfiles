---
name: harness-tuning
description: Create and maintain Pi skills, extensions, and agent instructions (AGENTS.md). MUST be loaded whenever any of them is created or modified, to prevent rule duplication, place behavior in the right location, and verify the change correctly.
---

# Harness Tuning

Guide for creating Pi skills and maintaining agent instructions (AGENTS.md) in an optimal, reliable way.

**Load this skill before any creation/modification of a skill or AGENTS.md.**

## Decision matrix: where does an instruction go?

| Need | Location | Loading | Salience |
|---|---|---|---|
| Global policy, applies to every session | `~/.pi/agent/AGENTS.md` | System prompt, every session | Strong early, **diluted** in long sessions |
| Tool usage mechanics (when to call it, how to fill params) | Tool description/schema | Re-sent on **every turn** | **Maximal**: read at the moment of the call decision |
| One-off expertise or workflow | Skill (`~/.pi/agent/skills/`) | Description always in context, body on demand | Good if the description is specific |
| Behavior/UI impossible to express in text | Extension (`~/.pi/agent/extensions/`) | Code, always active | Deterministic (no salience, it's code) |

**Golden rule**: if an instruction only matters in a specific context, it must NOT be in AGENTS.md.

**Extension code conventions**: the writing structure for `~/.pi/agent/extensions/` lives in `~/.pi/agent/extensions/AGENTS.md`. Read and follow it before creating or modifying any extension file.

## Anti-duplication (the most important principle)

1. **Single source of truth per detail** — numbers, thresholds, lists: one place only. Duplicating = drift (versions diverge → the model follows one at random).
2. **Redundancy only for critical triggers** — the rule whose omission costs the most (e.g., "ALWAYS use tool X") may live in AGENTS.md AND the tool description. Defense-in-depth, assumed.
3. **No tool mechanics in AGENTS.md** — "max 5", "2-3 options", parameter names: those go in the tool/skill description.

## Rules for writing rules

- **Brevity** — AGENTS.md is paid in tokens on every turn of every session. Every line must earn its place.
- **Imperative, no softeners** — "Always X", "Never Y", not "it would be good to". Soft rules get ignored.
- **Negative + positive alternative** — "Never ask open-ended questions" followed by "...use `ask_user_question`". A prohibition without an exit is poorly followed.

## Skill template

```
~/.pi/agent/skills/<skill-name>/
├── SKILL.md              # Required: frontmatter + instructions
├── scripts/              # Optional: executable scripts
└── references/           # Optional: detailed docs loaded on demand
```

**Minimal SKILL.md:**

````markdown
---
name: skill-name
description: What the skill does and WHEN to use it. Be specific — this text triggers loading.
---

# Skill Name

## Setup (if needed, once)

```bash
install command
```

## Usage

Direct, actionable instructions. Reference files with relative paths:
[details](references/REFERENCE.md), ./scripts/run.sh
````

**Frontmatter constraints:**
- `name`: 1-64 chars, lowercase letters, digits, hyphens (no leading/trailing or consecutive hyphens)
- `description`: max 1024 chars, **required** (skill not loaded otherwise)
- Good: *"Web search and content extraction via Brave Search API. Use for searching documentation, facts, or any web content."*
- Bad: *"Helps with search."*

## Keeping skills lean

- SKILL.md holds essential instructions only; depth goes into `references/` files.
- A single SKILL.md is fine while the skill stays small.
- If a skill grows or covers distinct topics (e.g., AGENTS.md authoring vs. skill authoring), split that guidance into `references/*.md` and point to it from SKILL.md.

## Checklist: create/update a skill

- [ ] `description`: what + **when to use** (the trigger)
- [ ] SKILL.md lean: essential instructions, pointers to `references/` for depth; split into `references/` if it grows or covers distinct topics
- [ ] No overlap with an existing skill or an AGENTS.md rule
- [ ] Referenced scripts exist and are tested
- [ ] Relative paths (never absolute) for internal references

## Checklist: add/modify AGENTS.md

- [ ] The rule applies to **all** sessions (otherwise → skill)
- [ ] It does not duplicate a detail already in a tool/skill description
- [ ] One line if possible, imperative, actionable
- [ ] Positive alternative provided if it's a prohibition

## Verification after modification

- Skill, extension, or AGENTS.md modified → verify it loads and behaves:
  - Run repo-specific config tests if the repo defines any.
  - Extension: `/reload` in the current session
  - AGENTS.md, skills: new session
  - Force-load a skill for testing: `/skill:<name>`
- Extension syntax check: `npx esbuild <file>.ts --outfile=/dev/null --format=esm --packages=external`

## Lint & format

Any code file created or modified under `~/.pi/agent` (extensions, tests, configs) → run from `~/.pi/agent`:

```bash
pnpm run lint                    # oxlint
pnpm exec oxfmt --write <files>  # format exactly the files you touched
pnpm run test                    # node --test tests/ — when tests cover the change
```

- Fix every error and warning in the files you create or modify. Pre-existing issues in untouched files: leave alone (no unrelated churn).
- Never format or lint markdown (`skills/**`, `AGENTS.md`) or Pi-managed state files (`models*.json`, `settings.json`, `auth.json`) — excluded by design in `oxfmt.config.ts`.