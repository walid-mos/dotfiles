# NextNode project audit

Extends the setup and audit instructions in `SKILL.md`. Deployment checks belong to `~/.pi/agent/skills/nextnode-deploy/cicd-checklist.md`.

## Audit flow

1. Read the project's agent instructions, package manifests, configs, workflows, `nextnode.toml` when present, and existing package imports.
2. Check package freshness first, then every applicable item below and in [setup.md](setup.md).
3. Read the owning reference before proposing any correction. Include deployment checks for a full project audit, not for a tooling-only request.
4. Report each item as `pass`, `missing` or `misconfigured`, with the observed state and evidence. Mark unreadable items as blocked rather than assuming compliance.
5. An audit is read-only unless the request also authorizes fixes. Present the findings and use `ask_user_question` for any consequential scope decision. With authorized fixes, complete that scope without asking again.

## Runtime and package manager

- [ ] `pnpm-lock.yaml` exists.
- [ ] `packageManager` pins the exact pnpm version from the core monorepo.
- [ ] `type = "module"` and `engines.node >= 24`.
- [ ] The project uses `@nextnode-solutions/standards`.

Read the core root `package.json`, workspace manifests and affected package docs for the current package roles. Do not maintain a copied package inventory here.

## Package freshness

For every `@nextnode-solutions/*` dependency, obtain the installed version through `pnpm list <pkg> --depth 0 --json` in the consuming package and compare it with `npm view <pkg> version`. Do not read lockfile contents or dependency internals. A manifest range alone cannot prove freshness.

`@nextnode-solutions/infrastructure` is private, versioned `0.0.0-development` and consumed from the core monorepo by Actions. Skip the npm lookup. Verify the monorepo revision used by CI instead.

Include standards, logger, worker-types when present, and every other NextNode dependency. Record deliberate compatibility pins before recommending updates. Resolve a confirmed unwanted difference with `pnpm update <pkg>` only after checking compatibility and the repository's release policy. Do not upgrade unrelated packages.

## Audit ownership

| Check | Read before proposing a fix |
|---|---|
| Required tooling configs, scripts, tests, commits or publishing | [setup.md](setup.md) and its relevant tooling reference |
| Common PR quality checks | [ci.md](ci.md) |
| nextnode.toml, deployment workflows, Dockerfile, env, secrets, routing or backing services | `~/.pi/agent/skills/nextnode-deploy/SKILL.md`, then its `cicd-checklist.md` |
| Logger API, injection or testing utilities | `~/.pi/agent/skills/nextnode-logger/SKILL.md` |
| Brand colors, typography, logos or UI conventions | `~/.pi/agent/skills/nextnode-design/SKILL.md` |

## Secrets and local environment

Run "Project secret workflow" in `~/.pi/agent/skills/nextnode-deploy/github-org.md` read-only. Record no-secret projects as not applicable with consumer evidence. CI and Worker checks belong to the deploy checklist.

- [ ] Required names are derived from actual consumers and compared with Infisical metadata for each applicable environment. Report every missing name and unreadable check without exposing values.
- [ ] Runtime secrets, public build settings and build-only tokens follow their supported input paths. Vault presence alone does not prove a build input works.
- [ ] For apps with secrets, `.infisical.json` is committed and links the checkout to the repository's Infisical project.
- [ ] For apps with secrets, the documented dev command runs through `infisical run --env=dev`.
- [ ] No secret value sits in a tracked file. Ask the developer to confirm `.env.local` and `.dev.vars` hold none, without reading them.
- [ ] The app types its secrets by augmenting `Cloudflare.Env`. No comment or doc still points to `[deploy].secrets` or GitHub secrets.

## Logger when used

- [ ] Use `@nextnode-solutions/logger` instead of `console.log`.
- [ ] Inject the logger through a constructor or parameter, rather than importing a global logger in business logic.
- [ ] Existing tests use utilities from `logger/testing`. Read the logger skill for `createSpyLogger`, `createNoopLogger` and `createMockLogger`.

## Date handling

The Temporal requirement lives in `SKILL.md`. For new code, replace date-library arithmetic and raw `Date` arithmetic with `Temporal.Instant.from(iso)`, `Temporal.PlainDate`, `.since()` and `.total('minute')`. Install the polyfill per package with `pnpm add @js-temporal/polyfill` when setup changes are authorized.

`Date.now()` is allowed only as epoch-ms input to `Temporal.Instant.fromEpochMilliseconds(Date.now())`. Flag `date-fns`, `luxon`, `dayjs` or `moment` dependencies before changing application code.
