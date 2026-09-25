# SOURCE.md

Vendored from `walid-mos/mac-config` (commit `0163257`, "chore(skills): resync nextnode @7185a94 + portage pi"), pi tree `pi/.pi/agent/skills/nextnode-deploy/`.

- Underlying facts updated at import (2026-09-24) against `NextNodeSolutions/core` @ `649362a` (HEAD; sync baseline was `7185a94`). The gap was PR #86 "workers zone firewall" (commits `73797c1`..`4748f5b`, 28 commits):
  - The four worker zone barriers now exist and are documented: `rate_limit`, `public_paths`, `limits`, `[[deploy.services.<name>.rate_limiters]]` — TOML vocabulary, load-time refusals (`deploy-worker-firewall.ts`, `worker-firewall.ts`), generated resources (`terraform-rate-limit.ts`, `terraform-firewall.ts`, `terraform-rulesets.ts` via `mergeRulesetFamilies`), production-only derivation (`zone-rules.ts` → `deriveRoutedWorkers`), Cloudflare plan gates (Pro+ rate limit, Free OK custom rules ≤ 5, Workers Paid `limits`), FNV-1a `/`-joined rate-limiter namespace ids, wrangler `limits`/`ratelimits` keys and `RL_<NAME>` → `RateLimit` typing.
  - Redirect ruleset fixed `kind: root` → `kind: zone` (fix `86c7c1c`).
  - SKILL.md: new rule 35 (zone barriers); `structure.md`: wrangler-document constants updated.
  - Note: this reverses part of the 2026-08-16 resync, which had deleted the firewall sections as unimplemented (audit finding C2) — they were implemented afterwards in PR #86.
  - `env` CLI now validates JSON env records with Valibot (`705cacb`) — same semantics, not documented as a separate contract.
- Update method: diff `packages/infrastructure` against the sync commit in SKILL.md, re-sync, then re-copy upstream if mac-config resyncs first.
