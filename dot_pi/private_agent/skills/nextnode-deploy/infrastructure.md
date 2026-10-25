# Infrastructure commands and contracts

Extends the command and implementation instructions in `SKILL.md`. Revision and update procedure live in [SOURCE.md](SOURCE.md).

Read `packages/infrastructure/src/index.ts` for command registration and `packages/infrastructure/CLAUDE.md` for dependency rules. The CLI runs from a core checkout in GitHub Actions with `node src/index.ts <command>`. It is not an npm deployment tool.

## CLI commands

Commands requiring configuration read `PIPELINE_CONFIG_FILE`. Deploy commands skip `package` projects. Application environments are defined in [pipeline.md](pipeline.md).

| Command | Input | Behavior |
|---|---|---|
| `plan` | Config | Emit quality tasks and pipeline outputs without provisioning |
| `teardown-guard` | Config | Require `TEARDOWN_CONFIRM` to match the project name |
| `load-secrets` | Vault Variables, optional `PIPELINE_ENVIRONMENT` | Log in through GitHub OIDC, expose platform secrets as masked step outputs and, with an environment, the repository's project as `PROJECT_SECRETS` |
| `provision` | Deployable config | Create the HCP workspace, ensure a PlanetScale database when declared and apply Terraform |
| `plan-infra` | Deployable config | Run Terraform plan and report changes to a PR comment or step summary |
| `migrate-remote` | Deployable config | Apply D1 migrations and then PlanetScale migrations when declared |
| `deploy` | Deployable config | Deploy already-built Workers, sync `PROJECT_SECRETS` to each scripted Worker and check public routes |
| `teardown` | Deployable config | Delete Worker scripts and destroy Terraform-managed resources |
| `generate-worker-types` | Deployable config | Generate declarations for scripted Workers from nextnode.toml |
| `prod-gate` | Environment | Require a successful development run for the production commit |
| `publish` | Environment | Run semantic-release with release-push recovery |
| `publish-result` | Environment | Parse semantic-release output and write publication status |
| `seed-platform-secrets` | `LEGACY_GITHUB_SECRETS` | Transitional. Copy platform credentials from GitHub secrets to the CI project, never overwriting |

Read the matching command module before supplying environment variables. Generated outputs are defined in `adapters/github/plan-outputs.ts`, not by an old workflow's comments.

## Implementation contracts

1. Keep command coordination in `cli/`, pure decisions in `domain/`, IO in `adapters/`, validation in `config/` and provider-independent primitives in `kernel/`. Read [structure.md](structure.md) for placement.
2. Extend `TARGET_DEFINITIONS` and `DEPLOY_PROVIDER_VALIDATORS` only for an actual consumer. Read `domain/deploy/target.ts` instead of copying its interface into a reference.
3. Keep resource ownership exclusive. Terraform owns backing resources, Access policies, zone firewall rules and redirects. Wrangler owns Worker code, custom domains, bindings, secrets and cron triggers. HCP Terraform stores state.
4. Resolve organization settings once through `cli/deploy/organization.ts` and pass them to adapters and builders. Credential and variable placement lives in [github-org.md](github-org.md).
5. Read secrets only through the vault. `domain/vault/secret-vault.ts` owns the project and environment layout, `cli/vault/open-vault.ts` the OIDC login and project lookup. Never add a `secrets.<NAME>` reference, a secret list in nextnode.toml or a hardcoded list of names. A job with `id-token: write` runs core's CLI only.
6. Declare every workload under `deploy.services`. Routing and ordering live in [multi-service.md](multi-service.md), environment projection in [deploy-env.md](deploy-env.md).
7. Require provisioned outputs for backing bindings. Type generation uses placeholder values, never cloud credentials or provision operations. Read [cloudflare-workers.md](cloudflare-workers.md) for its current limitations.
8. Treat deployment verification and production retirement as separate operations. A skill update or successful build does not authorize changing live resources.

## Removed deployment paths

The only deploy target is `cloudflare-workers`, inferred for both `app` and `static`. `package` projects publish without a deploy section. Pages and Hetzner are not selectable providers.

Use the current workflows in [pipeline.md](pipeline.md). Former `deploy-static.yml`, `deploy-workers.yml`, `plan-workers-diff.yml` and provider-specific teardown workflows are absent. Docker image builds, VPS provisioning, DNS CLI reconciliation, embedded Postgres, backup/restore commands and tailnet monitoring are absent too. The `check-secrets` command, generated secrets and secret declarations in nextnode.toml were removed with the Infisical vault.

Reject server-era configuration using [config.md](config.md). Do not recreate removed adapters, read archived server documents as current instructions or claim that updating a TOML file migrates a live database. Any live-resource transition needs its own approved scope.
