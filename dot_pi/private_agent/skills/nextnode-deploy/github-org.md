# GitHub settings and credentials

Extends the GitHub reference in `SKILL.md`. Read the consuming workflow, `packages/infrastructure/README.md` section "Secrets" and `packages/infrastructure/src/cli/deploy/organization.ts` before deciding which setting is missing.

## Infisical vault

Infisical is the only source of secrets. GitHub holds none and nextnode.toml declares none. Secrets sit at the root of an environment, with no folder.

| Infisical project | Environments | Content |
|---|---|---|
| `nextnode-ci`, id in the organization Variable `INFISICAL_PROJECT_ID` | `main` | Platform credentials shared by every pipeline |
| One per repository, named exactly like the repository | `dev`, `prod` | The secrets of that repository's Workers |

Workflows log in through GitHub OIDC as the organization identity `github-actions`, id in the organization Variable `INFISICAL_IDENTITY_ID`. It trusts only core's workflow files on `main`, through the `job_workflow_ref` claim, and the organization through `repository_owner_id`. It is Member on `nextnode-ci` and Viewer on each repository's project. The identity configuration table lives in the README's "Vault setup".

The free Infisical plan is the constraint: no custom roles, five identities, three environments per project, ten Secret Syncs. Do not propose Infisical Secret Syncs or a per-repository identity.


## Project secret workflow

Run this workflow during project setup and whenever a feature adds, renames or changes a secret consumer. An audit performs the same comparisons read-only. A request to change skills does not authorize changing any project's vault.

1. Resolve the repository name from its GitHub remote, not `project.name`, a package name or the checkout directory. Read the app's environment access, validation schemas, integration configs and example files without opening value-bearing local env files. Identify each required name, consumer, runtime or build phase, public or secret classification, and applicable environment. Keep this comparison in the task report, not a second committed secret manifest. Resolve dynamic names from their actual consumer.
2. Classify placement before writing. Worker secrets belong in the repository's project. Shared pipeline credentials belong in the CI project and require a platform change, not an application setup change. Public build settings belong in nonsecret configuration. Follow [deploy-env.md](deploy-env.md) for build limitations. A value stored in Infisical is not evidence that the build receives it. Continue repository vault provisioning only for application runtime secrets. If none exist, record the reason and skip project creation, while keeping unsupported build consumers blocked.
3. Inspect the available Infisical tool schemas or CLI help before use. Reuse the uniquely matching project. During authorized setup, create it if absent with the exact repository name and default environments, then ensure `github-actions` has Viewer membership. Preserve existing projects, values and memberships. A duplicate name or a missing project-management permission is a blocker, not a reason to select another project or broaden access.
4. Compare required names with the root keys in `dev` and `prod`, including imported names. Use a metadata-only operation. Do not call a list/get operation that returns secret values merely to check names. If the available tool cannot hide values before returning them, use a metadata-only CLI/API path or have the user check the names in the dashboard. Report each required name as present, missing, not applicable or blocked per environment. Present does not prove validity or provider permissions. Do not delete extra keys.
5. For authorized setup or feature work, populate missing values whose source is available through an authorized secure process. Use the dashboard or stdin with secret-bearing output suppressed, never chat, tool arguments, command arguments, logs or a temporary file. Generate a cryptographically random value only for a new app-owned signing or encryption secret whose format the consumer defines. Provider-issued credentials must come from that provider. Preserve existing values and keep environment credentials separate. Do not copy `dev` into `prod`, rotate a value or remove a key without explicit authorization.
6. If a provider credential or write permission is unavailable, complete the other steps and report the exact project, environment, missing names and required provider permission. Ask only for the human action that unblocks them, never for a secret in chat. Placeholders and empty values do not complete setup. For a rename, rotation or removal, check the next-deploy effects in [deploy-env.md](deploy-env.md) before changing the vault.
7. Complete [Local development](#local-development) and the app's secret declarations described in `~/.pi/agent/skills/nextnode-deploy/cloudflare-workers.md`, section "Generated Worker types". Keep example env files to empty placeholders with consumer and phase, never values. Reconcile declarations with the actual required names rather than editing generated bindings.
8. Verify the real local consumer through Infisical without printing its value. For an authorized CI deploy, inspect the vault load and Worker sync evidence, then exercise the affected feature. A successful `/healthz` alone does not prove a provider integration. Deployment is a separate authorization, never an automatic follow-up to a vault write. Without it, report runtime propagation as pending the next CI deploy.
9. Close with the project and environment, required names and their status, metadata or runtime evidence, and remaining human actions. Report local, vault and deployed status separately. Setup is complete only when all applicable required names are populated and the requested consumer checks pass. Unreadable, missing or unverified items stay explicit blockers.

The CI lookup uses the repository name, not `.infisical.json`. The next deploy syncs the environment to every scripted Worker, see [deploy-env.md](deploy-env.md).

## Local development

For a project with application secrets, developers use their own Infisical account, never the CI identity, and must be members of the repository's project. Reuse an existing `.infisical.json` after verifying its project id. A mismatch is a blocker, not permission to overwrite it. If absent, `infisical login`, then `infisical init` at the repository root links the checkout to the project and writes it. It holds the project id, not secrets. Commit it.

```sh
CLOUDFLARE_INCLUDE_PROCESS_ENV=true infisical run --env=dev -- pnpm dev
```

`infisical run` injects the `dev` secrets as process variables. It does not rewrite or remove existing env files. Wrangler's local runtime fills the Worker's `env` from `.dev.vars` or `.env`, not from the process. Cloudflare documents `CLOUDFLARE_INCLUDE_PROCESS_ENV=true` to include the process environment, only when no `.dev.vars` file exists. If one exists, report the conflict and obtain authorization before moving or removing user-owned files. Keep secret values out of local env files. Nonsecret settings may remain gitignored. Verify with the project's dev server before claiming a secret reaches `env` locally.

## Discover settings live

Secret values cannot be read back from GitHub or printed from Infisical in chat. Inspect names only:

```sh
gh variable list --org NextNodeSolutions
gh api /repos/NextNodeSolutions/<repo>/environments -q '.environments[].name'
gh secret list --org NextNodeSolutions
```

A remaining GitHub secret is a leftover of the migration, not a source. In Infisical, compare secret names in the project's `dev` and `prod`, never values.

## Organization variables

| Variable | Required when |
|---|---|
| `INFISICAL_PROJECT_ID` | Every workflow that loads secrets |
| `INFISICAL_IDENTITY_ID` | Every workflow that loads secrets |
| `TF_CLOUD_ORGANIZATION` | Every deployment |
| `PLANETSCALE_ORGANIZATION` | PlanetScale is declared or implied |
| `COMPANY_DOMAIN` | The project is internal |
| `ACCESS_SESSION_DURATION` | The project is internal |

These are nonsecret organization settings. The resolver rejects missing values and has no company-specific defaults. Pass the resolved organization configuration to adapters and Terraform builders rather than reading process variables from domain code.

## Deployment credentials

They live at the root of `nextnode-ci`, environment `main`. Each job loads them with `load-secrets` and maps step outputs to environment variables. Cloudflare uses `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The vault's `TF_CLOUD_TOKEN` becomes `TF_TOKEN_app_terraform_io` for Terraform and the HCP workspace adapter. Use an HCP team or user token, not an organization token.

PlanetScale operations require `PLANETSCALE_SERVICE_TOKEN_ID` and `PLANETSCALE_SERVICE_TOKEN`. A bare PlanetScale `needs` still requires these credentials because it implies the backing service.

Audit Cloudflare permissions against the resources actually declared. Routed Workers require script, account and zone route permissions. Terraform additionally needs permissions for the selected backing resources, DNS and rulesets. Internal projects require Access Apps and Policies permission. A listed secret name does not prove token scope or account ownership.

## GitHub App

`actions/create-github-app-token@v2` consumes `NEXTNODE_APP_ID` and `NEXTNODE_APP_PRIVATE_KEY` from the vault. Publishing uses its token for releases. Teardown uses it to check out the target repository. It no longer writes secrets anywhere.

The PR plan workflow uses `github.token` for comments, not an App token. Read the workflow's permissions before diagnosing comment failures.

Inspect the App's current installation rather than assuming its scope:

```sh
gh api /orgs/NextNodeSolutions/installations -q '.installations[] | select(.app_slug=="nextnode-ci")'
```

## Migration leftovers

`seed-vault.yml`, the `seed-platform-secrets` command and `domain/vault/legacy-seed.ts` are transitional. They copied the platform credentials from GitHub secrets once. Remove them with the GitHub secrets, then lower `github-actions` to Viewer on `nextnode-ci`. Generated secrets no longer exist: store a random value in Infisical yourself.

Set authorized secret values in the Infisical dashboard or through stdin, never command arguments or chat.

## CI evidence

```sh
gh run list --repo NextNodeSolutions/<repo> --limit 10
gh run view <run-id> --repo NextNodeSolutions/<repo> --log-failed
```

Use the failed job's logs and current config to distinguish a missing organization setting, a vault login refusal, a provider permission failure or an unsupported field. A deploy warning naming the visible Infisical projects means the repository's project is missing or the identity is not a member. Workflow dispatch is an external write and follows the deployment or teardown authorization, not a diagnostic default.
