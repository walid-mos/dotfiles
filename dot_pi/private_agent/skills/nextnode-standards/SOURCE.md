# SOURCE.md

Vendored from `walid-mos/mac-config` (commit `0163257`, "chore(skills): resync nextnode @7185a94 + portage pi"), pi tree `pi/.pi/agent/skills/nextnode-standards/`.

- Underlying facts updated at import (2026-09-24) against `NextNodeSolutions/core` @ `649362a` (`@nextnode-solutions/standards` **v1.25.0**; sync baseline was v1.22.0 @ `7185a94`):
  - `nextnode/no-generic-runtime-guard` (error, bc95e31 + b7a4e72) added to oxlint.md plugin table.
  - `typescript/no-unnecessary-condition` (error, `checkTypePredicates: true`, 82cf750) added to the type-aware list; `oxc/no-async-endpoint-handlers` disabled on purpose documented (292ebc8).
  - `eslint/no-nested-ternary` (error, e8665dd; inline rationale dropped at 11d6776) added to the conditionals row.
  - `eslint/no-magic-numbers` options updated: `enforceConst: true`, `ignore: [0, 1, -1]`, `ignoreEnums`, `ignoreReadonlyClassProperties` (ac5e6aa).
  - oxfmt export now typed (`OxfmtConfig & { ignorePatterns: string[] }`, c7e615a) — noted in configs.md.
  - TypeScript, Vitest, tsdown, commitlint, lint-staged, semantic-release configs: verified unchanged in `7185a94..HEAD`.
- 2026-10-15: secrets and local environment conventions added to `setup.md`, `audit.md` and `SKILL.md`, against `NextNodeSolutions/core` main `78418e8` (PR #102) and PR #103 at `d62bdab`, then unmerged. Source of truth: `packages/infrastructure/README.md`, section "Secrets". The deploy-side details live in the `nextnode-deploy` skill.
- Infisical onboarding now runs during setup and integration changes through the single project secret workflow in `~/.pi/agent/skills/nextnode-deploy/github-org.md`. Its pipeline contract was rechecked against clean local and remote core main `51a3e98b96f31f1da060eb9ee58f6e462b9ae9a1`, after PR #103 merged. Audits remain read-only. No live project was changed.
- Local consolidation: tooling setup now lives in `setup.md`. Project audit rules moved here from the former infra skill, whose provenance is preserved in [audit-source.md](audit-source.md).
- Local addition (2026-10-15): `scripts/apply-repo-rules.sh`, no upstream counterpart — applies repository-level rules after any repository creation (squash-only merge buttons, `delete_branch_on_merge`, squash commit message `PR_TITLE`/`PR_BODY`, Dependabot alerts and security updates, secret scanning and push protection for public repositories). Organization rulesets `org-squash-merge` and `org-default-branch` (created live on 2026-10-15) carry the default-branch policy for every repository; the script refuses to run without them. Project setup integration lives in `setup.md`, section "GitHub repository" (operator instruction: run the script during the nextnode-compliance step-by-step, after creating a repository if none exists).
- Update method: diff `packages/standards` against the sync commit in `setup.md`. Merge factual changes into the owning reference, preserving the local two-skill split and concise entry points.
