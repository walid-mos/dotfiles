# PlanetScale Postgres and migrations

Extends the database reference in `SKILL.md`. The current Postgres integration is `[services.planetscale]`, reached through Hyperdrive. Field definitions live in [config.md](config.md).

Read `packages/infrastructure/src/adapters/cloudflare/workers/provision-planetscale.ts`, `domain/cloudflare/workers/terraform-planetscale-resources.ts` and `adapters/planetscale/migrate.ts` before changing this flow.

## Provision and runtime

A workload declaring `needs = ["planetscale"]` receives `HYPERDRIVE`. It can imply an empty PlanetScale configuration when no table is declared. Organization settings and credentials live in [github-org.md](github-org.md).

The API adapter creates the database if absent before Terraform runs. Terraform creates a runtime role with read/write data permissions, a separate migrator role inheriting `postgres`, and the Hyperdrive configuration using runtime credentials.

Runtime Workers use the Hyperdrive connection string. They do not receive a database password or direct `DATABASE_URL` through the backing environment.

## Migrations

`migrate-remote` applies D1 first when present, then invokes the PlanetScale migration command. The command comes from `services.planetscale.migrate_command`, or `DEFAULT_MIGRATE_COMMAND` in `domain/deploy/target.ts` when omitted.

The subprocess runs on the GitHub runner from the directory containing nextnode.toml, with caller dependencies installed. Only that subprocess receives `DATABASE_URL`, built from sensitive migrator Terraform outputs with `sslmode=verify-full`. It connects directly to PlanetScale rather than through Hyperdrive.

A migration failure stops deployment. Its error includes the command, exit reason and bounded stdout/stderr with the database URL and password redacted. A timeout is reported separately. Inspect this evidence rather than rerunning a migration blindly.

Do not run migrations inside a Worker request handler or claim a git-diff gate controls the migration job. The current pipeline runs it whenever the backing service exists.

## Retention and limitations

Teardown preserves the PlanetScale database but destroys Terraform-managed roles and Hyperdrive. Retention and destructive-operation guards are defined in [multi-service.md](multi-service.md).

The CLI supplies no Postgres backup, restore or retention policy. Inspect the database provider's recovery settings for an authorized recovery operation. Embedded Postgres, wal-g and pg_dump sidecars are not part of this deployment system.

Generated binding declarations currently have a PlanetScale gap documented in [cloudflare-workers.md](cloudflare-workers.md). Confirm type generation separately from successful provisioning.
