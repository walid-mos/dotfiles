# Deployment compliance checklist

Extends the audit instructions in `SKILL.md`. Report every applicable item as pass, fail or not applicable, with config, workflow, command or real-flow evidence. An unperformed live check is unverified, not a pass.

## Configuration and callers

- [ ] Project name, type, domain and workloads satisfy [config.md](config.md), with no removed target or container fields.
- [ ] Deploy callers use the current `deploy.yml` for apps and static assets, not a provider-specific former workflow.
- [ ] Monorepo config paths and quality filters match the intended package. The root build actually produces every declared entry or assets directory.
- [ ] Production's `dev_workflow_file` identifies the real development caller. Any disabled production gate is explicit.
- [ ] PR infrastructure plans use `plan-diff.yml` and the caller grants `contents: read`, `pull-requests: write` and `id-token: write`.
- [ ] Callers declare their permissions, including `id-token: write`, and contain no `secrets: inherit`, `secrets:` block or `secrets.<NAME>` reference.
- [ ] Project scripts do not scan the infrastructure checkout during quality jobs. Read the setup behavior in [pipeline.md](pipeline.md).
- [ ] Config path and environment are serialized without cancelling a running deploy.

## Runtime and secrets

- [ ] Runtime SITE_URL and needs-filtered public vars follow [deploy-env.md](deploy-env.md). Build-time consumers have separately verified CI inputs.
- [ ] nextnode.toml declares no `secrets`. For runtime secret consumers, the repository has an Infisical project with its exact name, `github-actions` as Viewer, and populated required names in each applicable environment. Apply the project secret workflow in [github-org.md](github-org.md) read-only, including the no-secret case.
- [ ] Every scripted Worker of the repository is meant to read every secret of the project. A secret that must stay out of a workload is a reason to split the repository.
- [ ] The app types the secrets it reads by augmenting `Cloudflare.Env`. The deploy run shows no missing-project warning.
- [ ] Secrets are absent from TOML values, public vars, build steps and browser build output. No build step needs a secret, or the gap is reported.
- [ ] For apps with secrets, local development and `.infisical.json` follow "Local development" in [github-org.md](github-org.md). Local env files hold no secret values.
- [ ] Organization variables and platform credentials satisfy [github-org.md](github-org.md), with actual token scope and account ownership checked.
- [ ] Sibling calls use service bindings and the dependency graph is acyclic. Read [multi-service.md](multi-service.md).

## Worker behavior and protection

- [ ] Script entries and assets-only declarations match the build output. Assets-only workloads are not assigned scripted runtime behavior.
- [ ] Public routed workloads serve a healthy `/healthz`. Any public-path allowlist permits it.
- [ ] Internal workloads have Access protection on the correct environment-resolved hostnames and an organization email policy.
- [ ] Internal verification includes both an unauthenticated login redirect and an authenticated application check. A skipped smoke check is recorded as skipped.
- [ ] Alternate public endpoints are verified disabled. `workers_dev: false` alone is not evidence about preview URLs.
- [ ] Zone rule ownership and plan entitlements cover the generated firewall behavior. Development is not assumed protected by production-only zone rules.
- [ ] Invocation caps and in-Worker limiter calls satisfy [cloudflare-workers.md](cloudflare-workers.md), rather than relying only on declared bindings.
- [ ] Generated binding types are regenerated through the consumer's command, not edited or assumed complete. The PlanetScale generation limitation is checked when applicable.
- [ ] Non-production asset uploads carry the SEO guard. Scripted responses are checked separately when noindex behavior is required.
- [ ] Logs are enabled or an explicit exception explains the disabled setting. Read [observability-service.md](observability-service.md).

## Backing resources and schedules

- [ ] Backing resources are declared only for apps and each consumer selects them through `needs`. Queues are not assumed to have an undeclared consumer.
- [ ] D1 has at least one binding workload, the migration folder exists and CI applies remote migrations after provision.
- [ ] PlanetScale runtime and migration roles are separate. CI runs the declared migration from the TOML directory with private migrator credentials. Read [postgres-service.md](postgres-service.md).
- [ ] R2 CDN settings intentionally expose public data and private buckets have no public-domain resource. Read [r2-service.md](r2-service.md).
- [ ] Scheduled jobs have a scripted target with a scheduled handler. Parsed HTTP path/method fields are not assumed executed. Read [cron-service.md](cron-service.md).

## Destruction and verification

- [ ] Any teardown is separately authorized for its repository, project and environment. Its data guard covers D1, R2 and KV, with queue loss reviewed separately.
- [ ] HCP workspace and PlanetScale database retention are distinguished from destroyed roles, bindings and resources. No unsupported backup or restore operation is claimed.
- [ ] Verification names the commands and real behavior checked. Existing infrastructure scripts prove compilation or lint only, not live deployment or authenticated health.

Package publishing uses [kickstart-package.md](kickstart-package.md) and [pipeline.md](pipeline.md). Tooling and PR quality compliance belong to `~/.pi/agent/skills/nextnode-standards/SKILL.md`.
