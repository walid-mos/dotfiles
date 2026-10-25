# Cloudflare Workers

Extends the Worker configuration reference in `SKILL.md`. TOML fields live in [config.md](config.md), workflows in [pipeline.md](pipeline.md), runtime variables in [deploy-env.md](deploy-env.md).

## Provision and ownership

Read `src/adapters/cloudflare/workers/workers-provision.ts` and `src/domain/cloudflare/workers/terraform-config.ts` in `packages/infrastructure`.

Provision ensures an HCP Terraform workspace named `<project>-<environment>` with local execution, ensures the PlanetScale database when configured, then applies the generated Terraform document. Organization values come from [github-org.md](github-org.md).

Terraform manages backing resources, Access, redirects and zone firewall rules. Wrangler deploys the script or assets with an ephemeral generated configuration. Run deployment through [pipeline.md](pipeline.md), not with a hand-maintained Wrangler file.

## Worker bindings

`domain/cloudflare/workers/backing-bindings.ts` filters every binding by the workload's `needs`. An alias is uppercased and its dashes become underscores.

| Need | Runtime binding |
|---|---|
| `d1` | `DB` |
| `kv` | `KV_<ALIAS>` for each namespace |
| `queues` | Producer `QUEUE_<ALIAS>` for each queue |
| `r2` | `R2_<ALIAS>` for each bucket |
| `planetscale` | `HYPERDRIVE` |
| Sibling workload name | Uppercase sibling name, typed as `Fetcher` |

Declaring queues wires producers only. There is no queue-consumer declaration in the schema. Missing provision outputs for a requested binding fail deployment.

A scripted Worker with derived assets receives `ASSETS`. Assets-only Workers have no script, no `main`, no `vars` and no `ASSETS` binding. Do not assign runtime handlers or environment-dependent application behavior to an assets-only workload.

## Internal projects and Access

`project.internal = true` creates a Cloudflare Access application for every routed workload in both development and production. A shared allow policy matches the organization's configured email domain. At least one workload must have a `url`.

Read `domain/cloudflare/workers/terraform-access.ts` and `terraform-internal-resources.ts` before changing this policy. Access applications are derived only from workload URLs, not redirect domains. Verify redirect behavior separately instead of claiming every configured hostname has an Access application.

Generated configuration sets `workers_dev: false` for every Worker. It does not explicitly set `preview_urls: false`. Do not assume alternate endpoints are all disabled from the workers.dev setting alone. Verify the deployed endpoint settings when auditing Access protection.

Public routed Workers receive a `/healthz` smoke check. Internal projects skip that check because CI has no Access login. Verify the unauthenticated login redirect and the authenticated application separately. A skipped check proves neither.

## Zone and invocation controls

The four optional controls are owned by `config/worker-firewall.ts` and `config/validation/deploy-worker-firewall.ts`. Generation lives in `domain/cloudflare/workers/zone-rules.ts`, `terraform-rate-limit.ts`, `terraform-firewall.ts` and `wrangler-config.ts`.

```toml
[deploy.services.api]
entry = "dist/api.mjs"
url = "api.example.com"
public_paths = ["/api/contact", "/healthz"]

[deploy.services.api.rate_limit]
paths = ["/api/contact"]
methods = ["POST"]
requests_per_period = 5
period = 60
mitigation_timeout = 600

[deploy.services.api.limits]
cpu_ms = 5000
subrequests = 50

[[deploy.services.api.rate_limiters]]
name = "forms"
limit = 5
period = 60
```

| Control | Generated behavior | Scope |
|---|---|---|
| `rate_limit` | Zone rule blocking with a JSON 429 response, counted by IP and Cloudflare data center | Production only |
| `public_paths` | Zone custom rule blocking paths outside the allowlist | Production only |
| `limits` | Wrangler invocation limits, emitted only when the table is declared | Both environments |
| `rate_limiters` | In-Worker `RateLimit` bindings named `RL_<NAME>` | Both environments |

The parser enforces at most one workload with `rate_limit` and at most five with `public_paths`, regardless of the actual zone plan. Both require `url`. Other projects or unmanaged rules can still consume the same zone's allowance. A zone has one ruleset entry point per phase, so independent project workspaces cannot safely assume ownership of a shared phase.

The generated rate-limit rule uses Host, optional Method and a custom response. Check those features against the actual Cloudflare zone plan before deployment. Parsing does not validate plan entitlements. Invocation `limits` require a compatible Workers account plan and Wrangler version too.

Rate-limit paths must be nonempty. Request paths start with `/` and accept only a single trailing `*` as a prefix wildcard, without double quotes or backslashes. Empty `public_paths` blocks the entire hostname. Keep `/healthz` allowed for public routed Workers or the post-deploy check fails.

Zone periods accept 10, 60, 120, 300, 600 or 3600 seconds. Mitigation timeouts additionally accept 0 and 86400. Defaults are 60 and 600 respectively. An invocation limits table fills missing fields with 1000 CPU milliseconds and 50 subrequests. Without that table, neither default is emitted.

An in-Worker limiter requires a unique kebab-case name, a positive integer limit and a period of 10 or 60 seconds. Namespace IDs derive from project, environment, workload and limiter name using the slash-separated FNV-1a hash in `rate-limiter-namespace.ts`. Application code must call the binding to enforce it. The binding does not reject requests automatically.

## Generated Worker types

Use `@nextnode-solutions/worker-types` at type-check and build time. `worker-types gen` reads nextnode.toml, with `--config <path>` for a different file, and writes declarations into each scripted Worker's package directory. Assets-only workloads are skipped. Generate the declarations rather than editing them. The package README specifies that the output is gitignored.

Generated types cover bindings and public vars only. Secrets are not declared anywhere the generator can read, so the app types the ones it reads by augmenting `Cloudflare.Env` in its own declaration file, for example `src/env.d.ts`:

```ts
declare namespace Cloudflare {
  interface Env {
    RESEND_API_KEY: string
  }
}
```

The file must have no top-level `import` or `export`, otherwise wrap the namespace in `declare global`. Do not declare `module 'cloudflare:workers'` again: it collides with the generated declaration and drops the bindings. Keep the list in step with the Infisical project by hand. A typed name absent from Infisical is undefined at runtime.

The renderer reuses the deployment document with placeholder output values and performs no cloud provisioning. Read `cli/deploy/worker-types.ts`, `domain/cloudflare/workers/worker-env-types.ts` and `packages/worker-types/README.md` before changing the contract.

At the audited revision, PlanetScale type generation is incomplete. `typesPlaceholderOutputs` omits the Hyperdrive ID and `bindingMembers` omits Hyperdrive types. Do not claim `worker-types gen` supports PlanetScale merely because runtime deployment supports its binding. Verify the consumer's generation command before relying on it.

## Asset protection and verification

For non-production assets, deployment writes `_headers` with noindex and `robots.txt` denying crawling before uploading them. Production injects neither. This does not add response headers to arbitrary scripted API responses.

A successful public deployment requires a healthy `/healthz` route on each routed workload. Assets-only sites need a health asset at that path. Inspect the actual HTTP behavior, not only the deployment summary.
