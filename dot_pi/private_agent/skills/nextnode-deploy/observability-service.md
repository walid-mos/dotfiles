# Worker logs

Extends the logging reference in `SKILL.md`. Read `packages/infrastructure/src/config/validation/deploy-worker-services.ts` and `domain/cloudflare/workers/wrangler-config.ts` before changing log enablement.

Each workload's `observability` field controls the generated Wrangler `observability.enabled` setting. The default is enabled. Set it to false only for an explicit logging requirement, not to hide a failing operation.

Use Cloudflare Workers logs and metrics for the deployed script and environment. The CLI does not provision a log-retention, alerting or tailnet scraping service. Configuring provider-side retention requires a separate supported provider setting.

HTTP smoke checks and internal-project verification are defined in [cloudflare-workers.md](cloudflare-workers.md). A successful deployment summary with a skipped smoke check is not application health evidence.
