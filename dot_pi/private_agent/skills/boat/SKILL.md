---
name: boat
description: |
  Operate Boat cloud sandboxes with the boat CLI — create (ALWAYS --type small, the operator sizing rule), stop/resume/fork, ssh/exec, environments, and reading capacity/cost from the API (boat limits --json, boat usage). Load for any Boat sandbox task: sizing a machine, creating or resuming one, checking limits or credit balance, cost estimation, GitHub access in sandboxes, or troubleshooting the sandbox lifecycle. Also load when a plan file mentions Boat sandboxes.
---

# Boat sandboxes

Boat runs disposable Linux VMs ("sandboxes") on remote bare metal. CLI: `boat` at
`~/.ascii/bin/boat` (ensure it is on PATH). Add `--no-update` to any command to skip the
update check; update manually with `boat self-update`. Docs index: https://docs.boat.dev/llms.txt
(pricing, machines, cli-reference). Re-check the docs when numbers here might have drifted.

## Sizing rule — operator decision 2026-09-27

ALWAYS create with `--type small`. NEVER run `boat new` without `--type`: the CLI default is
`default`, which costs twice as much. Never pass a larger type unless the user explicitly asks.

| type    | $/h    | vCPU | RAM   | disk  | notes                          |
| ------- | ------ | ---- | ----- | ----- | ------------------------------ |
| small   | 0.018  | 2    | 4 GB  | 12 GB | the only size to use by default |
| default | 0.036  | 4    | 8 GB  | 50 GB | CLI default — costs 2x small   |
| large   | 0.072  | 8    | 16 GB | 125 GB | only on explicit user request |
| xlarge  | 0.200  | 16   | 32 GB | 251 GB | $100+ plan + operator allocation |

Resizing happens on resume/fork: `boat resume <id> --type default` (growing always works;
shrinking fails with `type_too_small` if the data no longer fits, leaving the sandbox untouched).

## Read capacity from the API before batch work

`boat limits --json` is the source of truth. Decisions it answers:

- `canStart` / `blockedReason` / `billingStatus` — can we create anything at all.
- `activeSandboxes` vs `maxActiveSandboxes` — concurrency headroom.
- `starts.day/hour/minute` (`limit` vs `remaining`) — creation-rate headroom.
- `creditBalanceHours` / `subscriptionRemainingSeconds` — the wallet, expressed in **seconds of
  `default` time** (100,000 s per dollar). A `small` sandbox draws 0.5 per second, so
  **1 balance-hour = 2 small-sandbox-hours**; halve the price, double the runtime.
- `trialLine` (when present) — one-line summary of current trial caps; obey it, do not hardcode caps.

`boat status --json` → login/plan health. `boat usage <id>` → one sandbox's real cost.
`boat billing` → wallet, packs, auto-refill.

## Command map

- Create: `boat new --type small --ttl <SECONDS>` (auto-stop timer; restarts on every resume)
- Observe: `boat list --json` · `boat info <id> --json` (watch `state`: provisioning → ready/idle/running → stopping → stopped)
- Shell: `boat ssh <id>` (interactive) · `boat ssh <id> -- bash -c '…'` (one-shot; needs the sandbox **ID**, not its display name)
- No-SSH exec: `boat exec <id> -- <cmd>` (runs over the Boat API; background + poll for long work)
- Lifecycle: `boat stop <id>` (snapshot, then free) · `boat resume <id>` · `boat fork <id>`
- Files: `boat scp` · environment secret files (below)
- Expose: `boat host` (public HTTPS URL) · `boat forward` (TCP to local machine)
- Environments: `boat env list|info|set|set-var|set-file|add-repo|upgrade` — repos, env vars,
  secret files, safety toggles; every change mints a new version, running sandboxes stay pinned
  until `boat env upgrade <env>`
- Onboarding links (dashboard URLs): `boat onboard --json` is safe to re-run when signed in

## Auth

Signed in via GitHub. If `boat status --json` reports `loginState: "signed out"`: run
`boat onboard --json`, have the user open the `url` it prints and complete OAuth, then re-run
`boat onboard --json` until the event is `login_complete`. Do not fabricate a signed-in state.

## Load on demand

- `operations.md` — stop/resume mechanics, what survives a resume, in-sandbox facts, GitHub
  private-clone setup, Tailscale. Load before driving a sandbox beyond a one-shot command, or
  when provisioning repos/secrets into an environment.
