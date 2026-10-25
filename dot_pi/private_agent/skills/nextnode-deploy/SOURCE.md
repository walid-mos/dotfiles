# Source and update procedure

## Provenance

The skill was imported from `walid-mos/mac-config` at `0163257`, under `pi/.pi/agent/skills/nextnode-deploy/`. It is locally maintained, with project tooling separated into `~/.pi/agent/skills/nextnode-standards/SKILL.md`.

Deployment facts were audited on 2026-10-14 against `NextNodeSolutions/core` at `e8268f7e3647a681600c15f5ba271ce6bdd5afe2`. The clean local checkout and remote main matched. This refresh includes merged PR #101, the cloud-only deployment change.

The secrets model was refreshed on 2026-10-15 against main at `78418e8`, which merged PR #102, and against PR #103 at `d62bdab`, then unmerged. PR #102 moved CI credentials from GitHub secrets to Infisical through GitHub OIDC. PR #103 removed secret declarations from nextnode.toml, `check-secrets` and generated secrets, and syncs each repository's Infisical project to its Workers. PR #103 subsequently merged as `6d4ee789`. Project onboarding was checked against clean local and remote main `51a3e98b96f31f1da060eb9ee58f6e462b9ae9a1`. The README, vault lookup, environment mapping, Worker sync and reusable build confirm the same contract. The project secret workflow in [github-org.md](github-org.md) adds local agent execution requirements, not a new pipeline feature. No live vault or deployment was changed.

## Refresh scope

Replaced removed provider workflows and server contracts with the current Worker deployment flow. Verified config validation, command registration, build ordering, Access, PlanetScale migration roles, KV data-deletion protection and Worker type generation against source. The secrets refresh verified the vault layout, project lookup, secret sync, rejected fields, workflow permissions and job trust boundary.

Former server-reference filenames now contain stop instructions and pointers, not executable deployment recipes. They do not provide a compatibility path. Live servers, databases and cloud settings were not changed.

Known source limitations are documented where they affect execution, including build-time environment inputs, preview endpoint verification and PlanetScale binding-type generation. Provider-plan entitlement was not verified live.

## Updating

1. Confirm the upstream revision and local changes before auditing. Start with `packages/infrastructure/CLAUDE.md` and its README.
2. Diff `packages/infrastructure`, `.github/workflows`, `.github/actions/setup` and `packages/worker-types` from the audited revisions above.
3. Read the changed validators, command registry, adapters and callers. Source code takes precedence over outdated workflow comments.
4. Update the owning reference and its load trigger in `SKILL.md`. Keep defaults and schemas in source rather than copying full type declarations into docs.
5. Check every reference link, source path, example and removed-path warning. Force-load `/skill:nextnode-deploy` in a fresh Pi session.
6. Record the new audited revision and date here. An updated skill does not establish live deployment or migration success.
