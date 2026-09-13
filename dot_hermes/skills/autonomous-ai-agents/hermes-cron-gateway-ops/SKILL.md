---
name: hermes-cron-gateway-ops
description: Use when diagnosing Hermes cron jobs or gateway service.
---

# Hermes Cron & Gateway Ops

Recurring lessons from maintaining Walid's two daily cron agents (Bookmarks Curator 06:00, Freelance Presence 09:00) and the gateway service on his Mac Studio.

## Scheduled-job model pinning

Jobs run in a fresh session with NO chat context. Their model comes from the job's own pin, not config.yaml. Inspect pins by reading `~/.hermes/cron/jobs.json` (`hermes cron list` hides model/provider).

```bash
hermes cron edit <job_id> --model <id> --provider <prov>          # pin model
hermes cron edit <job_id> --reasoning-effort xhigh                 # optional effort pin
```

There is no `hermes cron update`; the subcommand is `edit`.

### Pitfalls
- **Model IDs must match the upstream catalog exactly**, including org prefixes. `ox-alpha` → HTTP 404 while `stealth/ox-alpha` works. Verify against the live catalog before pinning:
  `curl https://inference-api.nousresearch.com/v1/models -H "Authorization: Bearer <token from ~/.hermes/auth.json>"`.
- **Provider matters as much as model.** The Nous portal route and the openai-codex route accept different ID namespaces for the same family (`openai/gpt-5.6-luna` @ nous vs `gpt-5.6-luna` @ codex).
- **Credits gate paid models.** A 404 whose body says "requires available credits" is a billing error, not a missing model. Walid's Nous portal account has no credits; his ChatGPT (openai-codex OAuth) works.
- **drift_skip is protective, not broken.** When global inference config changes after job creation, unpinned jobs refuse to fire ("provider X -> Y ... No inference call was made"). Fix = explicit pin, not disabling anything.
- **Never type into a cron session from the desktop job view.** The UI reopens it with the GLOBAL config (openai-codex default), not the job's pin → confusing 400s ("model not supported when using Codex") that look like a bad pin but aren't.
- After editing a pin, **verify with a real trigger** (`cronjob action=run`) before trusting tomorrow's schedule.

## Gateway / launchd service

The cron ticker only fires when the gateway runs: check with `hermes cron status` (look for "cron jobs will NOT fire").

- Service = user LaunchAgent `ai.hermes.gateway`. Install/repair: `hermes gateway install` (it self-repairs stale plists). Logs: `~/.hermes/logs/gateway.{log,error.log}`.
- **Walid's install has exactly one source of truth**: the self-install at `~/.hermes/hermes-agent` (uv venv, Python 3.11). The Homebrew formula was uninstalled 2026-08-25 — its package was incomplete (missing `hermes_cli.stderr_timestamp`) and crashed under launchd while working interactively, because the desktop backend exports a `PYTHONPATH` into the dev checkout that masked it. Never reinstall via brew; if a plist references `/opt/homebrew/.../hermes-agent`, reinstall via `~/.hermes/hermes-agent/venv/bin/hermes gateway install`.

## Current routing decision (2026-08-25)

Both jobs pinned to `gpt-5.6-luna` + provider `openai-codex`, reasoning xhigh. History of why: `stealth/ox-alpha`@nous = free but chronically capacity-limited (429); `openai/*`@nous = needs portal credits Walid doesn't have; codex route = proven working via his ChatGPT account. Revisit if ox-alpha capacity returns or he adds portal credits.
