# SOURCE.md

Vendored from `walid-mos/mac-config` (commit `0163257`, "chore(skills): resync nextnode @7185a94 + portage pi"), pi tree `pi/.pi/agent/skills/nextnode-standards/`.

- Underlying facts updated at import (2026-09-24) against `NextNodeSolutions/core` @ `649362a` (`@nextnode-solutions/standards` **v1.25.0**; sync baseline was v1.22.0 @ `7185a94`):
  - `nextnode/no-generic-runtime-guard` (error, bc95e31 + b7a4e72) added to oxlint.md plugin table.
  - `typescript/no-unnecessary-condition` (error, `checkTypePredicates: true`, 82cf750) added to the type-aware list; `oxc/no-async-endpoint-handlers` disabled on purpose documented (292ebc8).
  - `eslint/no-nested-ternary` (error, e8665dd; inline rationale dropped at 11d6776) added to the conditionals row.
  - `eslint/no-magic-numbers` options updated: `enforceConst: true`, `ignore: [0, 1, -1]`, `ignoreEnums`, `ignoreReadonlyClassProperties` (ac5e6aa).
  - oxfmt export now typed (`OxfmtConfig & { ignorePatterns: string[] }`, c7e615a) — noted in configs.md.
  - TypeScript, Vitest, tsdown, commitlint, lint-staged, semantic-release configs: verified unchanged in `7185a94..HEAD`.
- Update method: diff `packages/standards` against the sync commit in SKILL.md, re-sync the rule tables, then re-copy upstream if mac-config resyncs first.
