# Source

Vendored skill: `codebase-design` — shared vocabulary for designing deep modules (Ousterhout-style depth, seams, deletion test).

- **Upstream repo**: https://github.com/mattpocock/skills
- **Path in repo**: `skills/engineering/codebase-design/`
- **Revision**: `d81f3a183412e71a5b1e84ca21bc1a35eea03a60` (`d81f3a1`, merge of PR #1120 `release/v1.3`)
- **Vendored on**: 2026-10-01
- **License**: MIT (see upstream `LICENSE`, © 2026 Matt Pocock)
- **Discovered via**: https://x.com/mattpocockuk/status/2105563604384915639

## Files vendored

`SKILL.md`, `DEEPENING.md`, `DESIGN-IT-TWICE.md` (patched, see below). `agents/openai.yaml` intentionally **not** vendored: Codex-only adapter, inert in Pi — dead part removed per house rules.

## Local modifications (reapply on re-vendor)

1. `DEEPENING.md` — "Testing strategy: replace, don't layer": added an authorization gate (AGENTS.md § Tests — authoring/deleting tests requires explicit user authorization in the current request; a skill cannot grant it). Bullets changed to "flag them for deletion" / "when test work is authorized, write…".
2. `DESIGN-IT-TWICE.md` — "Spawn 3+ sub-agents in parallel" now names the Pi mechanism (`subagent` tool via `load_tools`, `pi-subagents` skill); GLOSSARY.md reference generalized to "the project's shared-language doc (GLOSSARY.md, AGENTS.md, or equivalent)".
3. `SKILL.md` — glossary: one line making project-defined vocabularies (CQRS, Feature-Sliced Design, DDD) win in code and docs; this glossary is for design reasoning only.

To update: re-clone upstream at a newer revision, re-copy, reapply the local modifications above, and keep this file's revision/date current.
