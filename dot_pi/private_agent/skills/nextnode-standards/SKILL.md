---
name: nextnode-standards
description: >-
  NextNode project conventions, compliance audits, shared tooling and PR CI.
  Load in NextNodeSolutions repositories, when any @nextnode-solutions/*
  dependency is present, or for NextNode setup, audits, tooling changes,
  integrations or new environment variables.
---

# NextNode project standards

## Instructions

1. Read the project's agent instructions, package manifests, scripts and affected configs.
2. For setup or an audit, read [audit.md](audit.md) and [setup.md](setup.md). Check the installed package versions, not dependency ranges.
3. For a specific tooling change, read its reference below before proposing a fix.
4. During project setup or when an integration adds or changes an environment variable, run the project secret workflow in `~/.pi/agent/skills/nextnode-deploy/github-org.md`. Reconcile required names and populate authorized missing secrets before calling the integration ready. Audits run it read-only and report gaps.
5. For deployment or infrastructure work, load `~/.pi/agent/skills/nextnode-deploy/SKILL.md`. PR quality checks belong here.

Every NextNode project uses `@nextnode-solutions/standards`. Use pnpm, ESM and Node >=24. Resolve the exact pnpm version from the core monorepo's `packageManager` field.

Infisical is required for project secrets. Read "Secrets and local environment" in [setup.md](setup.md) for its workflow and local setup pointers.

Use `Temporal` from `@js-temporal/polyfill` for new date/time code. Read "Date handling" in [audit.md](audit.md) before changing it.

## References

| Read when | File |
|---|---|
| Setting up a project or checking required configs and scripts | [setup.md](setup.md) |
| Adding an integration, reconciling required secrets, setting up local env or secret types | [setup.md](setup.md), section "Secrets and local environment" |
| Auditing a project, checking package freshness or changing date/time code | [audit.md](audit.md) |
| Configuring oxlint rules or overrides | [oxlint.md](oxlint.md) |
| Configuring TypeScript or choosing the compiler for a framework | [typescript.md](typescript.md) |
| Bundling a publishable package | [tsdown.md](tsdown.md) |
| Configuring an existing test suite | [vitest.md](vitest.md) |
| Configuring formatting, commits, releases, Tailwind, editorconfig or npmrc | [configs.md](configs.md) |
| Applying repository rules on a newly created repository | [scripts/apply-repo-rules.sh](scripts/apply-repo-rules.sh) |
| Adding or renaming PR CI or its required check | [ci.md](ci.md), [templates/parallel-ci.yml](templates/parallel-ci.yml) |
| Updating this skill against upstream | [SOURCE.md](SOURCE.md), [audit-source.md](audit-source.md) |

Arguments select the matching reference. No argument selects project setup.
