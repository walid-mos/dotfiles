# Project audit provenance

Extends the upstream-update reference in `SKILL.md`.

Vendored from `walid-mos/mac-config` (commit `0163257`, "chore(skills): resync nextnode @7185a94 + portage pi"), pi tree `pi/.pi/agent/skills/nextnode-infra/`.

- Underlying facts verified at import (2026-09-24) against `NextNodeSolutions/core` @ `649362a`: no `.github/workflows` or monorepo-overview change between the sync baseline `7185a94` and HEAD, so the checklist content is current. The workers zone firewall (PR #86) lives in the `nextnode-deploy` skill, not here.
- Import date: 2026-09-24. Local consolidation moved project audits to `audit.md` and deployment checks to `~/.pi/agent/skills/nextnode-deploy/cicd-checklist.md`. Package inventories now come from core manifests rather than a copied table.
- Update method: compare core manifests and workflows with the verified revision above. Merge changed conventions into the owning reference without recreating the former router skill.
