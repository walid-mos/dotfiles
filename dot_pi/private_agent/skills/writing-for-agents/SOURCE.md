# Source

- **Upstream**: https://github.com/mattpocock/skills — `skills/productivity/writing-for-agents/`
- **Revision**: `c55ee46073ed923f86ce59a5eb3b6d895095d1b7` (2026-09-18)
- **Vendored on**: 2026-09-26
- **Files**: `SKILL-MECHANICS.md`, `LICENSE` (MIT) — byte-identical copies.
- **Local deviations** (applied 2026-09-26; re-copying an upstream update reverts them — re-apply or re-audit):
  1. Frontmatter `description` and intro line widened from "skills, AGENTS.md or CLAUDE.md" to cover extensions, agent-facing docs (ARCHITECTURE.md, PRODUCT.md) and tool descriptions — matches our ecosystem (`harness-tuning` decision matrix); CLAUDE.md dropped (none in this setup).
  2. Deduplication against our house docs (they win): intro gained a placement pointer to `harness-tuning` / `skills/AGENTS.md`; "The two loads" context-load bullet compressed to a pointer to the `AGENTS.md` brevity rule; "Pruning" single-source-of-truth bullet compressed to a pointer — the full rule moved to `~/.pi/agent/AGENTS.md` (Development).
- **Not copied**: `agents/openai.yaml` (OpenAI packaging metadata, unused by Pi).
- **Update procedure**: re-copy from the upstream revision, re-check the audit findings in the session history (frontmatter name/`description` vs Pi's `skills/AGENTS.md` spec, `SKILL-MECHANICS.md` sub-file listing, cross-references to `../AGENTS.md` paths).
