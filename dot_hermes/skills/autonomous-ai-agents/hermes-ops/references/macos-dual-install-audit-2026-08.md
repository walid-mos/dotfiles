# Worked audit: macOS dual-install Hermes (2026-08-25)

Session where the cron `drift_skip` + gateway crash were diagnosed and fixed. Kept as evidence for the recipes in SKILL.md; facts may age.

## Timeline

1. Cron job "Bookmarks Curator — Twitter" skipped with:
   `RuntimeError: [drift_skip] Skipped to prevent unintended spend: global inference config drifted since this job was created (provider 'nous' -> 'openai-codex'; model 'stealth/ox-alpha' -> 'gpt-5.6-terra'), and this job is unpinned. No inference call was made.`
2. Both active jobs (Bookmarks Curator, Freelance Presence) hit it the same morning — drift is global, not per-job.
3. `hermes gateway install` via `/opt/homebrew/bin/hermes` installed a plist pointing at
   `/opt/homebrew/Cellar/hermes-agent/2026.8.13/libexec/bin/python`, which crashed at launch:
   `No module named hermes_cli.stderr_timestamp` (brew package 0.20.1 lacks modules that exist in self-install 0.20.2).
4. Interactive diagnosis was misleading: the desktop-app backend injects
   `PYTHONPATH=/Users/walid-mos/.hermes/hermes-agent:/Users/walid-mos/.hermes/hermes-agent/venv/lib/python3.11/site-packages`
   into shells, so the brew python could import the missing module there. launchd has no such env → crash only under launchd.
5. Fix applied: `~/.hermes/hermes-agent/venv/bin/hermes gateway install` → repaired plist to venv python, service up (`ai.hermes.gateway` PID live, ticker heartbeat OK).
6. Pins applied: both jobs pinned `--model ox-alpha --provider nous` via `hermes cron edit`; verified in `~/.hermes/cron/jobs.json`.

## Environment facts found

- Desktop app itself runs from the self-install: `~/.hermes/hermes-agent/apps/desktop/release/mac-arm64/Hermes.app`.
- Desktop exports `HERMES_DESKTOP_HERMES=/opt/homebrew/bin/hermes` into launchd inherited env — mixing worlds but harmless once services use the venv.
- PATH order interactive: `/opt/homebrew/bin/hermes` first, then `~/.hermes/hermes-agent/venv/bin/hermes`. Both report v0.20.2 (the brew wrapper execs libexec code but resolves `hermes_cli` through injected PYTHONPATH).
- Unrelated lookalike in LaunchAgents: `com.stow.hermes-gemma` (stow dotfiles repo), not a Hermes Agent service.

## Cleanup executed (2026-08-25, later same day)

`brew uninstall hermes-agent` done (autoremoved 49 orphan deps, ~350 MB). `which -a hermes` now resolves only to `~/.hermes/hermes-agent/venv/bin/hermes`. Desktop still exports `HERMES_DESKTOP_HERMES=/opt/homebrew/bin/hermes` until next app restart — harmless.

## Follow-up session: pin debugging (same day, 13:00–13:25)

1. Jobs pinned as bare `ox-alpha` → every run failed `HTTP 404: Model 'ox-alpha' not found`. Nous catalog ID is `stealth/ox-alpha` (confirmed against `/v1/models`). Re-pinned with full ID via `hermes cron edit`.
2. Two manual triggers then failed `HTTP 429 capacity upstream` on provider=nous after 3 retries — while a direct curl to the same model returned 200 three times. Conclusion: intermittent saturation, config was now correct.
3. User saw `HTTP 400 ... not supported when using Codex with a ChatGPT account` in the UI. Log forensics (`~/.hermes/logs/agent.log`, session `cron_c1a50f22fd97_20260825_132100`): the scheduled runs stayed on nous; a later turn in the SAME session came from a desktop-UI prompt (`tui prompt accepted`, 16 chars) and ran on openai-codex because UI turns use global config, ignoring the job pin. The 400 was user-driven, not a broken pin.
4. Fallback chain confirmed empty (`get_fallback_chain(config) == []`) despite fallback docs in config.yaml being present but commented; offered configuring one for 429 resilience (user decision pending).
