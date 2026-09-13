---
name: hermes-cron-toolset-diagnostics
description: "Use when a Hermes cron tool is missing, a scheduled job seems not to run, or a watchdog cron is silent."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [hermes, cron, toolsets, browser, browser-use, diagnostics, verification]
    related_skills: [hermes-agent]
---

# Hermes Cron Toolset Diagnostics

## When to Use

Use when a Hermes cron job lacks a requested tool, reports `ok` without the expected artifact, or mixes a backend-specific tool with the wrong effective toolset.

Use this skill when a scheduled Hermes job says a requested tool is unavailable,
when a job reports success without producing the expected artifact, or when a
backend-specific tool appears to have disappeared after a configuration or
update change.

This is a diagnostic and repair workflow, not a reason to conclude that a
feature is permanently unsupported. Tool availability is assembled at runtime
from the active profile, platform toolsets, per-job allowlists, backend mode,
credential/dependency checks, and the current process. Inspect the effective
runtime rather than relying on the prompt, an old report, or a remembered tool
list.

## 0. Fast triage when the user says "the cron doesn't run"

Before touching config, establish whether the scheduler fired at all. Verified
command set (macOS, default profile):

1. `cronjob(action='list')` — job exists? `enabled`? `paused_at`? `next_run_at`
   in the future? `last_status`? Empty `enabled_toolsets` on the job is a
   prime suspect for missing tools (see §3/§4A).
2. Scheduler liveness: `~/.hermes/cron/ticker_heartbeat` and
   `~/.hermes/cron/ticker_last_success` are epoch floats; compare with `date`.
   Fresh heartbeat + old `last_run_at` = scheduler fine, look elsewhere.
3. Real fire history: `sqlite3 ~/.hermes/cron/executions.db "SELECT job_id,
   started_at, finished_at, status, error FROM executions ORDER BY claimed_at
   DESC LIMIT 8"` — proves the job actually ran even when nothing was
   delivered.
4. Output dir: `~/.hermes/cron/output/<job_id>/` one `.md` per run; errors are
   in `~/.hermes/logs/errors.log` (grep the job's `cron_<job_id>_` prefix) —
   NOT `~/.hermes/cron/errors.log`, which does not exist.

### Watchdog jobs look like "no runs" when they are fine

A `no_agent` script job with silent-when-empty stdout and `deliver: 'local'`
produces no visible message at all. Do not conclude the scheduler is dead:

- `executions.db` shows `completed` runs with empty error.
- The output dir has `Status: silent (empty output)` files.
- The script's own state file (`last_run`) advances every tick.

For a Qonto-style forwarder, the definitive check is a manual
`--dry-run` plus verifying the mail boxes were actually readable (a guard
failure inside `list_envelopes` returns `[]` silently, indistinguishable from
"no new mail" — so probe the envelope command once before trusting an empty
result). Optional UX fix: append a one-line heartbeat (`OK <ts> — 0 factures,
0 erreurs`) so runs are visible; offer it to the user, don't add it
unprompted to a watchdog whose silence is intentional.

### Mirror a known-good sibling job

When one scheduled job works and a sibling does not, diff their job records
first. In a verified case the working job declared `enabled_toolsets:
["browser", "file", "terminal"]` while the failing one had none and every
browser tool check returned False during its runs (`_browser_cdp_check
returned False; dependent tools will be unavailable this turn` in
`~/.hermes/logs/errors.log`). Fix: `cronjob(action='update', job_id=…,
enabled_toolsets=[…])` copying the working sibling's list, then verify with a
manual `cronjob(action='run')` — a manual run in the SAME config as the
failing one is also a valid reproduction of the bug, not evidence it doesn't
exist. Always re-read the run's output file under
`~/.hermes/cron/output/<job_id>/` for the actual report instead of trusting
`last_status: ok`.

## 1. Classify the symptom before changing anything

Record three separate facts:

1. **Requested tool** — the exact name in the job prompt, for example
   `browser_exec`.
2. **Effective tool inventory** — the tools actually exposed to the current
   run. An absent tool cannot be invoked; do not claim that it was used.
3. **Task evidence** — the output file, API read-back, or artifact that proves
   the business task completed.

Treat these as different layers. A cron run can have a process-level `ok`
status while the task itself was not completed. Conversely, a tool can be
present but fail during execution. Report the layer that failed.

## 2. Resolve the effective cron toolsets

Use this precedence order:

1. Per-job `enabled_toolsets`, when non-empty.
2. `platform_toolsets.cron` from the active profile configuration.
3. Hermes' default toolset resolution when neither is set.

Inspect the active profile, not a different profile or a pre-update snapshot.
Check both the job definition and the config. If a job has
`enabled_toolsets: null`, it inherits the global cron list.

The cron allowlist must contain the toolset that owns the requested tool, plus
only the supporting toolsets needed by the workflow. Do not assume a human-
facing category label and a runtime toolset name are identical.

## 3. Map the tool to its owning toolset and backend

Search the installed Hermes source or use `hermes tools`/the official docs to
answer:

- Which registry entry owns the requested tool?
- Which `toolset` is attached to that entry?
- Does a `check_fn` gate it?
- Is there a backend mode that intentionally hides a sibling toolset?

Browser automation is the important example:

- The Browser Use CLI backend exposes `browser_exec` under the
  `browser-use` toolset.
- The built-in `browser_*` tools belong to the `browser` toolset.
- When Browser Use mode is active, the built-in browser requirement check is
  intentionally false because Browser Use replaces that surface.
- Therefore enabling only `browser` while Browser Use mode is selected can
  expose neither usable surface. Align the selected backend and the effective
  toolset.
- `browser_exec` is additionally removed by the session-level security gate
  when `terminal` is absent from the effective tool inventory: Browser Use
  executes Python on the host, so a cron allowlist that needs `browser_exec`
  must include `browser-use` **and** `terminal` (plus `file` only if it writes
  local artifacts). This requirement is per job; do not broaden unrelated
  cron jobs.

Do not “fix” this by adding unrelated broad toolsets. Preserve cron's narrow
security boundary.

## 4. Choose the smallest repair

### A. The job explicitly requires `browser_exec`

Give that job the `browser-use` toolset and the minimum file/toolset required to
persist results. A per-job allowlist is usually safest because it does not
expand every cron job. If the toolset is configured globally, make the global
cron list match the selected backend instead.

After changing toolsets, start a new cron session or restart the gateway as
required by the deployment. Tool changes are not retroactive to an already
assembled conversation/tool schema.

### B. The job is written for the built-in `browser_*` API

Select the built-in browser backend explicitly and enable `browser`, then
verify its runtime prerequisites. Do not silently rewrite a job that relies on
Browser Use CLI semantics such as `browser_exec`, `js()`, or named Browser Use
sessions.

### C. A dependency or credential check fails

Run the relevant Hermes diagnostic (`hermes doctor` or the browser-specific
setup/status flow), fix the prerequisite, then create a fresh run. Capture the
fix, not the transient missing-dependency failure, as the reusable lesson.

### D. A user-closable helper service the job depends on

If a scheduled job depends on a launchd-managed helper (e.g. a dedicated agent Chrome exposing CDP on 127.0.0.1:9223) and the user wants to be able to close it (validated 2026-09-01: `RunAtLoad=false` + `KeepAlive=false` instead of an h24 process), the job's prompt must self-start it: probe the port (`curl -s --max-time 3 http://127.0.0.1:9223/json/version`), and when down run `launchctl kickstart gui/$(id -u)/<label>`, then poll the probe (~10 × 2 s) before using the tool. Cap total wait (~30 s) and fail with a short report rather than retrying forever. The service stays registered in launchd even with both flags false, so `kickstart` works cold — verified.

Never put passwords, cookies, bearer tokens, or CSRF values in reports or skill
files. Use the existing session/keychain mechanism and redact secrets.

## 5. Verify the repair end to end

Before declaring success:

1. Confirm the fresh run's effective tool inventory contains the requested
   tool.
2. Exercise the real path, not only a config read.
3. For browser work, verify the page/session is authenticated before attempting
   private data, and verify the extracted IDs/content.
4. For writes, read back the exact external target. For local files, verify the
   expected JSON/artifact and run the real builder or validator.
5. Check that counts agree across collection, classification, external writes,
   archive, and final state. Never report a count from an unverified claim.
6. If collection is unavailable, do not update `known_ids`, `last_run`, or
   downstream archives as though the run succeeded.

For a scheduled job, “no exception” is not enough. The acceptance criterion is
the requested artifact and its read-back evidence.

## 6. Report clearly when blocked

Use a short report with:

- the exact missing tool or failed layer;
- the effective configuration mismatch or prerequisite evidence;
- what was and was not changed;
- whether the task artifact was verified;
- the smallest corrective action.

Do not substitute public web search for authenticated private data. Do not
invent a no-change result merely because the collection step could not run.

## Durable references

- See `references/browser-backend-toolset-matrix.md` for the Browser Use vs
  built-in-browser mapping and the concrete mismatch pattern that motivated
  this workflow.

## Pitfalls

- Treating a cron `ok` status as proof that the mission succeeded.
- Concluding "the scheduler is dead" for a watchdog/no_agent job whose design
  is silence; check `executions.db` and the output dir first.
- Trusting an empty envelope listing as "no new mail" without probing that the
  mailbox read itself succeeded (silent `[]` on guard failure).
- Assuming `browser` automatically includes `browser_exec`.
- Treating `hermes doctor`'s "`browser` / `browser-cdp` (system dependency not met)" as a fault to repair: in Browser Use CLI mode this masking is intentional (`browser_exec` replaces the `browser_*` surface) and `check_browser_requirements()` returns False by design. Install Playwright Chromium only if actually switching to the built-in backend; do not cite the warning as "browser broken".
- Reading a stale profile snapshot instead of the active profile.
- Changing config but reusing a session whose tool schema was already built.
- Writing state after an unverified collection.
- Reporting private-data results obtained from a public search fallback.
- Hand-editing Hermes configuration when the supported config/cron command is
  available.
