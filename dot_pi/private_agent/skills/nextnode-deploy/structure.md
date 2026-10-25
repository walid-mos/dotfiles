# Infrastructure module placement

Extends the module-placement reference in `SKILL.md`. Read `packages/infrastructure/CLAUDE.md` for the binding dependency rules. The command registry lives in `src/index.ts`.

Put command coordination under `src/cli/`, configuration parsing under `src/config/`, pure transformations under `src/domain/` and provider IO under `src/adapters/`. Provider-independent primitives belong under `src/kernel/`.

Keep organization environment lookup in `cli/deploy/organization.ts`. Pass its resolved configuration into provider adapters and pure builders.

Worker-specific generation belongs in `domain/cloudflare/workers/`. Terraform, HCP, Wrangler and PlanetScale IO belongs in the matching adapter directory. Add behavior at the existing deployment registry rather than duplicating command dispatch.

Find the current files with scoped file tools. Do not copy a source tree or interface declaration into these references. No Hetzner, Pages, storage-state or monitoring layer should be inferred from an archived document.

For runtime contracts read [infrastructure.md](infrastructure.md). For schema changes read [config.md](config.md), and for ownership changes read [cloudflare-workers.md](cloudflare-workers.md).
