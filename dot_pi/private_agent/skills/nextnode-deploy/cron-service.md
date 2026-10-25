# Native Worker schedules

Extends the scheduled-job reference in `SKILL.md`. Read `packages/infrastructure/src/config/validation/cron.ts` and `domain/cloudflare/workers/wrangler-config.ts` before changing schedules.

```toml
[[deploy.cron]]
name = "cleanup"
schedule = "0 3 * * *"
path = "/api/cron/cleanup"
service = "web"
```

The job becomes a native Wrangler `triggers.crons` entry on the selected Worker. Implement the Worker's scheduled handler. Deployment does not call the declared HTTP path and does not create a cron container.

## Parsing constraints

Names are unique kebab-case identifiers. Schedules use five numeric cron fields with ranges, lists and steps. Macros and out-of-range values are rejected.

`service` names a declared workload. Omitting it selects the first declared workload. Target a scripted Worker, not an assets-only workload that has no scheduled handler.

The parser still requires an absolute `path` without whitespace, quotes, backslashes or backticks. `method` accepts GET or POST and defaults to POST. Both are parsed but unused by native triggers. Preserve these fields until the schema changes.

When the cron section is present, the parser still reserves the workload name `cron`. This is a parsing constraint, not proof of a runtime sidecar.

Configured triggers are emitted in both environments. An environment-specific schedule needs a schema or workflow change, not an undocumented production-only assumption.
