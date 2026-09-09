# Skills — authoring conventions

Applies to every directory under `skills/`. Placement discipline (AGENTS.md vs tool description vs skill vs extension) lives in the `harness-tuning` skill, whose loading is mandated in `../AGENTS.md` before any skill is touched. This file is the artifact spec for skills: follow it; do not restate it elsewhere.

## Layout

One folder per skill, kebab-case:

```
skills/<skill-name>/
├── SKILL.md              # required: frontmatter + always-on core instructions
├── <topic>.md            # depth, loaded on demand — flat siblings ...
└── scripts/              # optional: executables
```

- `SKILL.md` at the folder root is what makes the folder a skill — a directory without one is not a skill.
- Depth lives in sub-files (flat siblings like `coding/architecture.md`, or a `references/` directory — one pattern per skill, never mixed) and holds worked examples, mechanics, and judgment calls. List every sub-file in SKILL.md with its load-on-demand trigger.
- Relative paths for references inside the skill; absolute (`~/.pi/agent/...`) for anything outside it (sibling AGENTS.md files, other skills).

## Frontmatter (SKILL.md)

- `name`: 1-64 chars, lowercase letters, digits, hyphens; no leading/trailing or consecutive hyphens; identical to the folder name.
- `description`: required (the skill does not load without it), max 1024 chars. States what it does AND when to load it — this is the trigger. Specific beats generic:
  - Good: "Web search and content extraction via Brave Search API. Use for searching documentation, facts, or any web content."
  - Bad: "Helps with search."

## No duplication — applied to skills

- Examples (code blocks or named examples), enumerations, and rule phrasings have exactly ONE home: SKILL.md or one sub-file — never both.
- A sub-file opens by naming what it extends: "Extends <section> in `SKILL.md`; the core rules are not restated here." It then adds worked examples, mechanics, and judgment calls — never reframes the rules.
- The only acceptable double presence: the NAME of a critical rule + a one-line summary in SKILL.md, with the mechanics single-homed in the sub-file (summary ↔ depth).
- No overlap with `../AGENTS.md`, other skills, or tool descriptions; cross-file coupling is a link, never a retelling.
- Before finishing: grep each distinctive phrase or example you added across the skill's files — expected count: 1 (except the allowed summary ↔ depth pattern).

## Checklist — create or modify a skill

- [ ] `description`: what + **when to use** (the trigger), present, ≤ 1024 chars
- [ ] SKILL.md: always-on core only; depth single-homed in sub-files, listed with their trigger in SKILL.md
- [ ] Relative internal paths; links instead of retellings; absolute paths outside the skill
- [ ] Scripts exist and are tested (if `scripts/`)
- [ ] Verbatim-overlap grep clean; no intersection with `../AGENTS.md` or other skills

## Verify

- New session; force-load a skill for testing: `/skill:<name>`.
- No lint or format for skills - they are markdown, under harness-tuning's Lint & format (which also governs code exercises in `scripts/`).
