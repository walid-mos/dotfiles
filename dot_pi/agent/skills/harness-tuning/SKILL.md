---
name: harness-tuning
description: Create and maintain Pi skills, extensions, agent instructions (AGENTS.md), and persistent agent-facing docs (ARCHITECTURE.md, PRODUCT.md, …). MUST be loaded whenever any of them is created or modified, to prevent rule duplication, place behavior in the right location, and keep every doc wired so agents actually read it.
---

# Harness Tuning

Placement discipline for agent instructions: where a rule lives decides whether it gets followed, diluted, or silently lost.

**Load this skill before any creation/modification of a skill, extension, AGENTS.md, or agent-facing doc (ARCHITECTURE.md, PRODUCT.md, …).**

Each artifact kind has its own artifact spec — read it before authoring that kind:

- Skills: `~/.pi/agent/skills/AGENTS.md`
- Extensions: `~/.pi/agent/extensions/AGENTS.md`

## Decision matrix: where does an instruction go?

| Need | Location | Loading | Salience |
|---|---|---|---|
| Global policy, applies to every session | `~/.pi/agent/AGENTS.md` | System prompt, every session | Strong early, **diluted** in long sessions |
| Tool usage mechanics (when to call it, how to fill params) | Tool description/schema | Re-sent on **every turn** | **Maximal**: read at the moment of the call decision |
| One-off expertise or workflow | Skill (`~/.pi/agent/skills/`) | Description always in context, body on demand | Good if the description is specific |
| Behavior/UI impossible to express in text | Extension (`~/.pi/agent/extensions/`) | Code, always active | Deterministic (no salience, it's code) |

**Golden rule**: if an instruction only matters in a specific context, it must NOT be in AGENTS.md.

## Additive docs must be wired

An agent-facing reference doc (ARCHITECTURE.md, PRODUCT.md, …) that nothing points to is dead text. Never create one standalone:

1. If this skill's description lacks the creation trigger, widen it — descriptions are always in context; that is the wire.
2. Add a one-line read-pointer ("Read X before …") in the artifact spec, skill, or AGENTS.md governing when it must be read. Never duplicate the doc's content there.
3. Verify the chain: `rg -n '<doc name>'` from context files to the doc — every hop must exist on disk.

## Anti-duplication (the most important principle)

1. **Single source of truth per detail** — numbers, thresholds, lists: one place only. Duplicating = drift (versions diverge → the model follows one at random).
2. **Redundancy only for critical triggers** — the rule whose omission costs the most (e.g., "ALWAYS use tool X") may live in AGENTS.md AND the tool description. Defense-in-depth, assumed.
3. **No tool mechanics in AGENTS.md** — "max 5", "2-3 options", parameter names: those go in the tool/skill description.

## Rules for writing rules

- **Brevity** — AGENTS.md is paid in tokens on every turn of every session. Every line must earn its place.
- **Imperative, no softeners** — "Always X", "Never Y", not "it would be good to". Soft rules get ignored.
- **Negative + positive alternative** — "Never ask open-ended questions" followed by "...use `ask_user_question`". A prohibition without an exit is poorly followed.

## Checklist: add/modify AGENTS.md

- [ ] The rule applies to **all** sessions (otherwise → skill)
- [ ] It does not duplicate a detail already in a tool/skill description
- [ ] One line if possible, imperative, actionable
- [ ] Positive alternative provided if it's a prohibition

## Verify after modification

Follow the Verify section of the artifact spec you touched (`~/.pi/agent/skills/AGENTS.md` or `~/.pi/agent/extensions/AGENTS.md`). Root `~/.pi/agent/AGENTS.md`: confirm loading in a new session.

## Lint & format

Any code file created or modified under `~/.pi/agent` (extensions, tests, configs) → run from `~/.pi/agent`:

```bash
pnpm run lint                    # oxlint
pnpm exec oxfmt --write <files>  # format exactly the files you touched
pnpm run test                    # node --test 'tests/**/*.test.ts' — when tests cover the change
```

- Fix every error and warning in the files you create or modify. Pre-existing issues in untouched files: leave alone (no unrelated churn).
- Never format or lint markdown (`skills/**`, `AGENTS.md`) or Pi-managed state files (`models*.json`, `settings.json`, `auth.json`) — excluded by design in `oxfmt.config.ts`.
