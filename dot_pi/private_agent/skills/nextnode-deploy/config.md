# nextnode.toml configuration

Extends the configuration reference in `SKILL.md`. Read `packages/infrastructure/src/config/load.ts`, `config/types.ts` and the affected `config/validation/` module before changing a field. These files own the schema and defaults.

## Scripted application

```toml
[project]
name = "my-app"
type = "app"
domain = "example.com"

[deploy.services.web]
url = "example.com"
entry = "dist/server/entry.mjs"
needs = ["d1"]

[services.d1]
migrations_folder = "drizzle"
```

`deploy.target` can be omitted. Its only accepted explicit value is `cloudflare-workers`. A deployable project requires `project.domain` and at least one workload. Bundle and asset paths resolve from the directory containing nextnode.toml.

## Static assets

```toml
[project]
name = "my-site"
type = "static"
domain = "example.com"

[deploy.services.web]
url = "example.com"
entry = false
assets = "dist"
```

`static` uses a Worker serving assets, not Pages. Any nonempty backing-services configuration is forbidden for `static` and `package` projects. Choose `app` when the project needs backing resources.

## Project and pipeline fields

| Field | Contract |
|---|---|
| `project.name` | Required lowercase alphanumeric identifier with internal dashes |
| `project.type` | Required `app`, `static` or `package` |
| `project.filter` | Workspace package selector or `false`, default `false` |
| `project.domain` | Required for deployment, the zone lookup and hostname boundary |
| `project.redirect_domains` | Hostnames redirected to the project domain in production |
| `project.internal` | Boolean, default `false`. Access behavior lives in [cloudflare-workers.md](cloudflare-workers.md) |
| `scripts.lint`, `scripts.test`, `scripts.build` | Script name or `false`, default to the corresponding field name |
| `environment.development` | Boolean, default `true`. Controls inclusion of the production gate |
| `package.access` | Required nonempty string when the package table is present |

`scripts.build` is parsed but the current deploy workflow runs `pnpm build` unconditionally. Publishing runs a separate Turbo build. Do not claim `build = false` skips those workflow steps. See [pipeline.md](pipeline.md).

## Workload fields

Each `deploy.services.<name>` name uses the project-name identifier grammar.

| Field | Contract |
|---|---|
| `url` | Optional hostname, unique among workloads and equal to or under `project.domain` |
| `entry` | Bundle path, default `dist/server/entry.mjs`, or `false` for assets only |
| `assets` | Required only with `entry = false`. Forbidden with a scripted entry |
| `needs` | Backing-service names or declared sibling workloads, default empty |
| `depends_on` | Declared sibling workloads deployed first, default empty |
| `observability` | Workers Logs enablement, default `true` |
| `rate_limit`, `public_paths`, `limits`, `rate_limiters` | Optional security controls described in [cloudflare-workers.md](cloudflare-workers.md) |

A script entry directly under `<base>/server/` derives assets from `<base>/client`. An entry containing `/_worker.js/` derives assets from the directory before that segment. Unmatched entries emit no assets. Check `domain/cloudflare/workers/assets-directory.ts` for the exact derivation.

## Secrets

nextnode.toml declares no secret. Every scripted Worker receives every secret of the Infisical project named after the repository, for the deployed environment. Store, rename or delete a secret in Infisical, not in this file. The sync lives in [deploy-env.md](deploy-env.md) and project setup in [github-org.md](github-org.md).

`deploy.secrets` and `deploy.services.<name>.secrets` fail validation with an explicit error, so a leftover list is not mistaken for a filter. Generated secrets were removed too: create a random value yourself and store it in Infisical.

## Backing services

Declare backing resources only for `type = "app"`. Except for PlanetScale, a workload's `needs` does not create a missing backing-service declaration.

| TOML declaration | Fields | Definition |
|---|---|---|
| `[services.d1]` | `migrations_folder`, default `drizzle`, and optional `check_command` | `config/validation/services/d1.ts` |
| `[[services.kv.namespaces]]` | Kebab-case `name` | `config/validation/services/kv.ts` |
| `[[services.queues]]` | Kebab-case `name` | `config/validation/services/queues.ts` |
| `[[services.r2.buckets]]` | Kebab-case `name` and optional `cdn`, default `false` | `config/validation/services/r2.ts` |
| `[services.planetscale]` | Optional `cluster_size`, `region`, `migrate_command` | `config/validation/services/planetscale.ts` |

Bindings live in [cloudflare-workers.md](cloudflare-workers.md), R2 domains in [r2-service.md](r2-service.md), PlanetScale roles and migrations in [postgres-service.md](postgres-service.md). Native schedules live in [cron-service.md](cron-service.md).

## Rejected configuration

- `deploy.target = "hetzner-vps"` or `"cloudflare-pages"` fails target validation.
- `deploy.vps`, `deploy.volumes` and `deploy.hetzner` fail provider validation.
- Workload `port`, `source`, `ref`, `registry_auth_secret`, `context`, `dockerfile`, `target` and `build_args` are forbidden container fields.
- `[services.postgres]`, `[services.observability]` and other unregistered services fail with an unknown-backing-service error.
- `deploy.secrets` and workload `secrets` fail validation. Secrets live in the repository's Infisical project.
- Any deploy section is forbidden for `type = "package"`.

Validation is not a blanket unknown-key detector. Some unrelated keys are ignored. Successful parsing does not prove an undeclared feature exists.
