# Fork notes

Vendored fork of `pi-subagents`, maintained locally so the version Pi loads is
pinned, auditable, independent of upstream releases, and trimmed to the
surfaces the owner actually uses inside Pi.

| | |
| --- | --- |
| Upstream | https://github.com/nicobailon/pi-subagents |
| Base | upstream `v0.75.0`, commit `ad56bf92` |
| Package manager | pnpm only |
| License | MIT, © 2026 Nico Bailon (see `LICENSE`) |

## Where it lives

- **The package**: `~/.pi/agent/packages/subagents`, listed in the `packages`
  setting of `~/.pi/agent/settings.json`. This directory is the only copy:
  there is no separate repository, branch or worktree, and it is not under
  version control. Change the code here, then run the gates below.
- **Remote Linux "Boat"**: `~/.local/bin/pi-boat` copies this package and runs
  `pnpm install --ignore-scripts` there.

Nothing is published to npm: the package is `private`, has no `bin`, `files`
or build step, and Pi runs `index.ts` directly. Upstream is no longer tracked.

## Deltas against upstream

The base is upstream `ad56bf92`. There is no commit history to consult, so
this list is the only record of what the fork changes. Behavior changes:

1. **pnpm** — `pnpm-workspace.yaml` declares this checkout its own workspace
   root (so `pnpm install` here does not resolve `~/.pi/agent`) and records the
   `allowBuilds` decisions. Scripts and docs use pnpm.
2. **Async run PIDs** — `status.json`, nested summaries and
   `subagent:async-started` record `runnerPid` (detached runner, the only PID
   stop/interrupt/reconcile may target) or `ownerPid` (foreground Pi owning an
   in-process workflow, probed for liveness only) instead of one overloaded
   `pid`.
3. **Liveness `stale` state** — no observed activity for
   `control.staleAfterMs` (default 10 min) marks a run `stale` without stopping
   it; any child event clears it. `needsAttentionAfterMs` and
   `activeNoticeAfterMs` default to 120 s and `notifyOn` includes `stale`.
4. **Opt-in run deadlines** — runs have no built-in 30-minute cap. Only a
   call-level `timeoutMs`/`maxRuntimeMs`, agent frontmatter `timeoutMs` or the
   global `timeoutMs` config bounds a run.
5. **Acceptance repair** — invalid acceptance evidence resumes the retained
   child session to repair it.
6. **Supervisor decision wait** — blocking `contact_supervisor` asks have no
   implicit expiry (only a positive `PI_INTERCOM_ASK_TIMEOUT_MS` sets one),
   `subagent_supervisor` pending output carries the question body, request
   notices guide the parent to `ask_user_question` then `reply`, and a per-turn
   `context` hook reminds the parent of pending decisions.
7. **User model/thinking pins** — user-settings `agentOverrides.<name>.model`
   and `.thinking` win over project overrides, `agentOverridesByProvider` and
   project `disableThinking`; `/subagents` saves those edits in the scope that
   owns the field.
8. **Agent roster** — answers the read-only `pi-subagents:agent-roster:v1`
   event for sibling extensions.
9. **Builtin workflow resources** — `multi-issue-scout` and `parallel-gates`
   join upstream's `review` and `run-ci`.
10. **Missions are explicit** — a mission exists only when a launch passes
    `missionId` or a `mission` object, or `mission.create` makes one.
11. **Per-run output directories** — `singleRunOutputBaseDir` only moves the
    root: relative `output` paths resolve under `{root}/{runId}/`, as they do
    without the option. Upstream resolved them under the root itself, so
    concurrent runs of an agent with a default `output` shared one file and
    read each other's result.

## Removed subsystems

Deleted with their schema fields, actions, config keys, docs and tests because
the owner does not use them: external CLI/job runners and the external-runs
registry; the watchdog subsystem (the reviewer keeps `watchdog_diff`); the
prompt-template delegation bridge and structured delegation API; scheduled
runs; Herdr project panes and saved-machine placement; the extension RPC
bridge; agent refinement overlays; the Orca progress observer; the legacy chain
runtime, dynamic fanout and saved chains; run history, pi-web liveness, Gist
share, the upgrade notice, inspector registration, Ghostty, required child
extensions, command supervision, built-in MCP, MCP imports and prompt audit;
`subagents_enable` tool activation and `disabledFeatures`; the mission goal
driver, decisions and workflow state; the Worktrunk provider and
`worktree.cleanup`; pi-intercom result delivery; public package API subpaths
and the runtime agent and capability-ceiling registries; subagent profiles and
host inspection; the bundled council and prompt shortcuts; the
`/subagents-doctor`, `/subagents-guide`, `/subagents-models`,
`/subagents-steer`, `/subagents-stop` and `/subagents-refine` commands (use the
matching `subagent({ action })`).

Upstream distribution leftovers are gone too: CI workflows, the review-bot
config, the npm build/pack scripts, the installer, the changelog, the banner,
npm packaging smoke tests and upstream's contributor policy (`VISION.md`).

## Gates

Run in the package directory: `pnpm run typecheck`, `pnpm run test` and
`pnpm run test:integration`. Keep the delta list above current.
