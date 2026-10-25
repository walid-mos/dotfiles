# Build and runtime environment

Extends the environment reference in `SKILL.md`. Read `packages/infrastructure/src/cli/deploy/resolve-deploy-context.ts`, `domain/cloudflare/workers/worker-vars.ts`, `cli/vault/load-secrets.command.ts` and `domain/cloudflare/workers/secret-sync.ts` before changing projection.

## Runtime vars

`buildWorkerVars` emits only the public environment for backing resources selected by a Worker's `needs`, plus its `SITE_URL`. PlanetScale contributes a binding rather than a database URL variable. The generated Wrangler `vars` block is public and must not contain secret values.

`computeSiteUrl` in `domain/deploy/domain.ts` is the hostname rule's single home. It returns an HTTPS URL using the workload's `url`, or the project domain when the workload is hostless. Development adds `dev.` to the hostname. Consume computed URLs without adding another scheme or hostname prefix.

Sibling addressing uses bindings described in [multi-service.md](multi-service.md). No sibling `<NAME>_URL` variables are injected.

## Build-time values

The `build` job of `deploy.yml` runs `pnpm build` at the caller's workspace root, with no secret, no OIDC token and no build-environment input. It does not inject `SITE_URL` or application secrets. Runtime projection cannot change values that a framework already inlined during compilation.

If a framework needs a build-time canonical URL or other public setting, inspect its build script before claiming the runtime value covers it. The reusable workflow cannot pass one today. Do not add unsupported `build_args` to nextnode.toml or hardcode an environment-specific URL to hide this gap.

A build step that needs a secret, such as a Sentry sourcemap upload with `SENTRY_AUTH_TOKEN`, has no supported path in `deploy.yml`. Report it as a gap rather than adding `id-token: write` or a secret to `build`. Read [pipeline.md](pipeline.md) before changing reusable build behavior.

## Worker secrets

nextnode.toml declares no secret. The repository's Infisical project, named exactly like the GitHub repository, is the list. Development reads its `dev` environment and production its `prod` environment, at the root, without folders. Secret imports at the root are included, and the project's own values override them.

1. In `deploy`, `load-secrets` runs with `PIPELINE_ENVIRONMENT` set. It finds the project among those the `github-actions` identity is a member of and emits the whole environment as one masked JSON output, `PROJECT_SECRETS`.
2. `resolveDeployContext` reads `PROJECT_SECRETS`. Every scripted Worker of the deploy receives the same full set. A workload with `entry = false` receives none.
3. After each `wrangler deploy`, `syncWorkerSecrets` runs `wrangler secret list`, then one `wrangler secret bulk` on stdin. The payload sets every Infisical value and maps every name the Worker holds but Infisical lacks to `null`, which deletes it.

The Worker therefore holds exactly the Infisical environment after a deploy. Deleting a secret in Infisical removes it from the Worker at the next deploy. A change in Infisical reaches the Worker only at the next deploy, never live. Values never enter the generated Wrangler document, command arguments or a file.

All Workers of a repository share one project, monorepos included. A secret cannot be scoped to one workload. Split repositories, or accept that every scripted Worker can read it.

`mergeServiceEnvs` checks collisions within the public channel and within the secret channel, not across them. Keep secret names distinct from generated vars such as `SITE_URL` and the backing-resource variables.

## Failure and first-run behavior

- **No project for the repository.** `load-secrets` writes a run warning listing the projects it can see, emits no `PROJECT_SECRETS`, and the deploy leaves every Worker's secrets untouched. A missing membership looks identical to a misnamed project.
- **Two visible projects with the repository's name.** The lookup fails rather than picking one.
- **Project without a `dev` or `prod` slug.** The Infisical read fails and so does the deploy. Keep the default environments Infisical creates.
- **Empty environment.** An existing project with an empty `dev` or `prod` emits `{}`. The sync then deletes every secret the Workers held.
- **Missing value at runtime.** Nothing checks that the app's expected names exist. A forgotten secret surfaces as an undefined `env` member in the Worker. Type it in the app, see [cloudflare-workers.md](cloudflare-workers.md).

PlanetScale migration credentials come from Terraform outputs, not from Infisical. Read [postgres-service.md](postgres-service.md).
