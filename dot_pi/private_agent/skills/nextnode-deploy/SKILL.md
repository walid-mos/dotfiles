---
name: nextnode-deploy
description: >-
  NextNode deployment through nextnode.toml and GitHub Actions.
  Load for Cloudflare Workers apps or static assets, project secret onboarding,
  integration credentials and the Infisical vault,
  Terraform state and resources, Cloudflare Access, D1, KV, Queues, R2, PlanetScale migrations,
  deployment audits, package publishing, or @nextnode-solutions/infrastructure changes.
---

# NextNode deployment

## Instructions

1. Read the project's agent instructions, `nextnode.toml` and caller workflows.
2. Verify behavior against the current `NextNodeSolutions/core` revision. Start with `packages/infrastructure/CLAUDE.md`, its linked README, the affected `src/` code and `.github/workflows/`. The last audited revision lives in [SOURCE.md](SOURCE.md).
3. Use Cloudflare Workers for both `app` and `static` projects. Read [infrastructure.md](infrastructure.md) before changing infrastructure code or interpreting a removed target or command.
4. Read the matching references below before changing deployment configuration. For a compliance audit, report every applicable item in [cicd-checklist.md](cicd-checklist.md) as pass, fail or not applicable with evidence.
5. Keep secrets in Infisical only. Never declare secret names in nextnode.toml, never reference `secrets.<NAME>` or pass `secrets: inherit` in a workflow. Run the project secret workflow in [github-org.md](github-org.md) during setup or secret-consumer changes. Read [deploy-env.md](deploy-env.md) before changing runtime propagation.
6. Load `~/.pi/agent/skills/nextnode-standards/SKILL.md` for project tooling, conventions and PR quality checks.
7. Verify with the package's existing commands and the requested real flow. Infrastructure has no test suite. Compilation alone does not prove deployment, Access authentication or migrations.

## References

| Read when | File |
|---|---|
| Selecting a CLI command, changing deployment contracts or encountering a removed target | [infrastructure.md](infrastructure.md) |
| Editing or interpreting nextnode.toml | [config.md](config.md) |
| Auditing deployment setup or backing services | [cicd-checklist.md](cicd-checklist.md) |
| Changing reusable workflows, quality tasks, production gates or caller workflows | [pipeline.md](pipeline.md) |
| Changing build environment, runtime vars, SITE_URL or Worker secrets | [deploy-env.md](deploy-env.md) |
| Configuring workload routing, sibling bindings, deployment order or teardown | [multi-service.md](multi-service.md) |
| Configuring Worker assets, resource bindings, Access, firewall rules or generated types | [cloudflare-workers.md](cloudflare-workers.md) |
| Configuring R2 buckets or CDN domains | [r2-service.md](r2-service.md) |
| Configuring PlanetScale Postgres, database roles or migrations | [postgres-service.md](postgres-service.md) |
| Configuring Worker logs or investigating a skipped smoke check | [observability-service.md](observability-service.md) |
| Configuring native Worker scheduled handlers | [cron-service.md](cron-service.md) |
| Onboarding Infisical, reconciling integration secrets, configuring local env, organization variables or CI access | [github-org.md](github-org.md) |
| Starting a publishable package and its publishing workflow | [kickstart-package.md](kickstart-package.md) |
| Changing infrastructure layers or module placement | [structure.md](structure.md) |
| Encountering a former Hetzner caller configuration | [hetzner-caller.md](hetzner-caller.md) |
| Encountering former VPS networking or Tailscale deployment instructions | [hetzner-vps.md](hetzner-vps.md) |
| Encountering the removed golden-image builder | [golden-image.md](golden-image.md) |
| Encountering Docker or image-build deployment instructions | [turborepo-docker.md](turborepo-docker.md) |
| Updating this skill against upstream | [SOURCE.md](SOURCE.md) |
