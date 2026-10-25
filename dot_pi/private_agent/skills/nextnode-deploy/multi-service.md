# Multiple Worker workloads

Extends the workload reference in `SKILL.md`. Field validation lives in [config.md](config.md), environment rules in [deploy-env.md](deploy-env.md).

## Routing and sibling calls

Declare workloads under `deploy.services`. A routed workload has a unique `url` within the project domain. Wrangler attaches its custom domain using the environment-resolved hostname. A workload without `url` has no public route and is reached by a sibling binding.

A `needs` entry naming a sibling creates a service binding to that sibling's deployed Worker. It also requires the sibling to deploy first. `depends_on` adds ordering without adding a binding. Backing-service needs select resources, not sibling URLs.

Read `packages/infrastructure/src/domain/cloudflare/workers/service-bindings.ts` and `depends-on-order.ts` before changing this graph. Self-bindings and unknown references are rejected. Cycles fail ordering. Deployment is sequential, stops on failure and is not an atomic rollback of earlier Workers.

The deployed script name comes from `worker-name.ts`. Use that function rather than constructing script names in another module.

## Assets and shared resources

All paths resolve from the TOML directory. A shared project can declare different bundle entries for different workloads. Every scripted workload derives its own assets directory using the rule in [config.md](config.md).

There is one D1 database and one PlanetScale database per project environment. Multiple Workers can bind the same database. D1 migration selection uses the first workload declaring `needs = ["d1"]`, not an exactly-one-owner restriction. A declared D1 without any binding workload fails migration.

## Teardown

Use the manually dispatched workflow in [pipeline.md](pipeline.md), after explicit authorization for the selected project and environment. The project-name confirmation is checked before teardown.

`domain/cloudflare/workers/teardown.ts` requires `wipe_data` when the project declares D1, any R2 bucket or any KV namespace. This guard runs before deleting Worker scripts. Queues are not included in this guard. Do not treat its absence as proof that queue data survives.

Teardown deletes every configured Worker through Wrangler, then destroys Terraform-managed resources. Missing scripts are accepted as already deleted. Other deletion failures stop the operation.

The HCP workspace remains with state history. PlanetScale databases remain because they are created outside Terraform, while their runtime and migrator roles and Hyperdrive configuration are destroyed. Database retention is not a backup or restore mechanism.

There is no automatic final backup, volume preservation switch or restore command. Read provider recovery settings separately before authorizing data deletion.
