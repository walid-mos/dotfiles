# SOURCE.md

Vendored from `walid-mos/mac-config` (commit `0163257`, "chore(skills): resync nextnode @7185a94 + portage pi"), pi tree `pi/.pi/agent/skills/nextnode-infra/`.

- Underlying facts verified at import (2026-09-24) against `NextNodeSolutions/core` @ `649362a`: no `.github/workflows` or monorepo-overview change between the sync baseline `7185a94` and HEAD, so the checklist content is current. The workers zone firewall (PR #86) lives in the `nextnode-deploy` skill, not here.
- Import date: 2026-09-24. Update method: diff `NextNodeSolutions/core` (monorepo overview + `.github/workflows`) against the sync commit in SKILL.md, re-sync the packages table and DAG, then re-copy upstream.
