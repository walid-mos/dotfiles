# Source

Vendored skill: `improve-codebase-architecture` — audits a codebase for shallow modules / deepening opportunities (applying the deletion test) and presents candidates as a self-contained HTML report. This is the upstream companion to `codebase-design` and covers the audit use case from the triggering tweet.

- **Upstream repo**: https://github.com/mattpocock/skills
- **Path in repo**: `skills/engineering/improve-codebase-architecture/`
- **Revision**: `d81f3a183412e71a5b1e84ca21bc1a35eea03a60` (`d81f3a1`, merge of PR #1120 `release/v1.3`)
- **Vendored on**: 2026-10-01
- **License**: MIT (see upstream `LICENSE`, © 2026 Matt Pocock)
- **Invocation**: manual only (`disable-model-invocation: true` upstream, kept) → `/skill:improve-codebase-architecture`

## Files vendored

`SKILL.md` (patched, see below), `HTML-REPORT.md` (unmodified). `agents/openai.yaml` intentionally **not** vendored: Codex-only adapter, inert in Pi — dead part removed per house rules.

## Local modifications (reapply on re-vendor)

1. "Call the Skill tool with …" → Pi form: `codebase-design` loads via `/skill:codebase-design`; the design-it-twice bullet references "the `codebase-design` skill" directly.
2. Upstream companion skills `grilling` and `domain-modeling` are **not vendored**: the grilling step is inlined as a decision-tree loop, and the domain-modeling skill call is dropped — its operative side effects (GLOSSARY.md term updates, ADR offers) remain as bullets, so no dangling references.
3. GLOSSARY.md references generalized to "the project's shared-language doc (`GLOSSARY.md` when present)"; the "spawn a sub-agent" step names the Pi mechanism (`subagent` tool via `load_tools`, `pi-subagents` skill).

To update: re-clone upstream at a newer revision, re-copy, reapply the local modifications above, and keep this file's revision/date current.
