---
name: hermes-ops
description: "Fix Hermes cron drift, gateway crash, dual-install drift."
version: 1.0.0
---

# Hermes Ops (this machine)

Class of task: Hermes Agent itself misbehaves on Walid's Mac Studio — cron jobs skip, gateway won't fire, launchd service crashes, or two installations shadow each other. The bundled `hermes-agent` skill is a hub without machine-specific repair recipes; this one carries them.

## Install layout (source-of-truth map)

Two coexisting installs; **self-install wins** everywhere that matters:

| Source | Path | State (2026-08-25 audit) |
|---|---|---|
| Homebrew | `/opt/homebrew/Cellar/hermes-agent/` | older, its package lacks some modules |
| Self-install | `~/.hermes/hermes-agent/` (+ `venv/`) | newer, git checkout, hosts the desktop app |

Interactive shells get `PYTHONPATH=~/.hermes/hermes-agent:...venv/lib/python3.11/site-packages` injected (by the desktop app backend), which masks brew-package gaps. **launchd does not** — anything installed as a service must be driven by the venv binary.

## Procedure: cron `[drift_skip] Skipped to prevent unintended spend`

Cause: the global inference config changed since the job was created (e.g. provider `nous`→`openai-codex`, model swap) and the job is unpinned. No tokens were spent; the job stays skipped until pinned.

1. `hermes cron list` — find affected job(s). Check ALL jobs: the same drift hits every unpinned job at once (2026-08-25: both Bookmarks Curator and Freelance Presence).
2. Pin via CLI (the in-session `cronjob` tool cannot set model/provider pins):
   ```
   hermes cron edit <job_id> --model <model> --provider <provider>
   ```
3. Verify the pin landed in `~/.hermes/cron/jobs.json` (`model` + `provider` fields per job).
4. **Use the model ID EXACTLY as listed in the provider catalog.** For Nous, check `GET https://inference-api.nousresearch.com/v1/models` (Bearer token in `~/.hermes/auth.json`). E.g. the ID is `stealth/ox-alpha` — pinning bare `ox-alpha` passes the edit but every run fails `HTTP 404: Model 'ox-alpha' not found`.

## Reading cron run failures by error class

| Error | Meaning | Action |
|---|---|---|
| `[drift_skip] ... unpinned` | Config drift guard | Pin the job (above) |
| `HTTP 404: Model '<x>' not found` | Pin uses a non-catalog model ID | Re-pin with exact catalog ID |
| `HTTP 429: temporarily at capacity upstream` | Transient provider saturation — NOT your key or config | Retry later; consider a fallback chain |
| `HTTP 400: The '<x>' model is not supported when using Codex with a ChatGPT account` | The call went to openai-codex while carrying a Nous model name — see the UI-turn trap below |

Distinguish capacity vs misconfig with a direct probe before touching anything:

```bash
TOKEN=$(python3 -c "...extract nous access_token from ~/.hermes/auth.json...")
curl -s -m 30 https://inference-api.nousresearch.com/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"model":"stealth/ox-alpha","messages":[{"role":"user","content":"say ok"}],"max_tokens":5}'
```

200 here + 429 in the cron logs = intermittent upstream capacity; retry, don't reconfigure.

## Trap: desktop-UI turns on a cron session ignore the job's pin

Opening/typing into a cron job's session from the Hermes desktop app runs that turn with the GLOBAL inference config (e.g. `openai-codex` / `gpt-5.6-terra`), not the job's pinned provider+model. Signature in `~/.hermes/logs/agent.log`: same `cron_<jobid>_*` session, first turns on `provider=nous`, then a later turn suddenly on `provider=openai-codex` with `tui prompt accepted` just before. So a 400 "not supported when using Codex" inside an otherwise correctly-pinned job usually means a human typed in the job view — it does NOT mean the pin broke. Never diagnose or "fix" the pin based on those UI turns alone.

## Procedure: gateway not running / launchd crash

1. Diagnose: `hermes gateway status` then `tail ~/.hermes/logs/gateway.error.log`.
2. Symptom signature of the dual-install trap: works interactively but launchd log shows `No module named hermes_cli.stderr_timestamp` (or similar) from the Homebrew python path.
3. Fix: re-install the service with the venv binary —
   ```
   ~/.hermes/hermes-agent/venv/bin/hermes gateway install
   ```
   It detects and repairs the stale plist. Confirm: `launchctl print gui/$(id -u)/ai.hermes.gateway` shows `ProgramArguments` pointing at `~/.hermes/hermes-agent/venv/bin/python`, and `hermes cron status` reports "cron jobs will fire automatically".
4. If still failing, check for a second supervisor conflict: only one `ai.hermes.gateway` should exist (`ls ~/Library/LaunchAgents | grep hermes`). `com.stow.hermes-gemma` is unrelated (stow dotfiles).

## Audit recipe: which install am I actually running?

```
which -a hermes                                  # PATH order
<each> --version                                 # version + install dir
brew list --versions hermes-agent                # is brew formula present?
ps eww $(pgrep -f 'gateway run' | head -1)       # env of live service (VIRTUAL_ENV, PYTHONPATH)
zsh -ic 'echo $PYTHONPATH'                       # what the shell injects
```

Read `references/macos-dual-install-audit-2026-08.md` for the full worked example and the open cleanup decision.

## Fallback chain (for capacity 429s)

Config keys: `fallback_providers` (list) / legacy `fallback_model` — read via `hermes_cli.fallback_config.get_fallback_chain`; empty by default. When the pinned primary exhausts its 3 retries, Hermes activates the chain (`run_agent._try_activate_fallback`). Add one with `hermes fallback add` so cron jobs survive upstream saturation instead of failing the run.

## Pitfalls

- Don't diagnose from an interactive shell alone — the injected `PYTHONPATH` hides exactly the breakage launchd will hit. Reproduce with `env -i <python> -c 'import ...'`.
- After fixing a service, verify end-to-end (`hermes cron status` heartbeat), don't trust the installer's success message alone.
