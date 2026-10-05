# Maintenance readiness — 2026-10-03

Self-contained report on the repair and vendoring of the owner's `pi-subagents`
fork, written for the daily harness maintenance that must decide whether to
take this package back into its active roots.

## Verdict

- **Code and gates: ready.** `pnpm run typecheck`, `pnpm run test` and
  `pnpm run test:integration` pass in place, in the vendored copy and in an
  isolated copy installed from scratch with `pnpm install --frozen-lockfile`.
- **Reintegration: not done, and it needs owner decisions first** (see
  [Before reintegration](#before-reintegration)). The maintenance configuration
  still lists the old checkout in `deferred_roots`; it was not modified.

## What changed

| | Before | After |
| --- | --- | --- |
| Base | upstream `v0.67.0` + 7 prune commits + uncommitted owner work + an automated "Hermes" repair | upstream `v0.75.0` (`ad56bf92`) + 41 commits on branch `wm/vendor/main` |
| Loaded by Pi from | `~/Development/tools/pi-subagents` working tree (uncommitted state) | `~/.pi/agent/packages/subagents` (copy of the commit named in its `SOURCE.md`) |
| Package manager | npm and pnpm mixed in one `node_modules` | pnpm only (`pnpm-lock.yaml`, `savePrefix: ""`) |
| Host SDK for typecheck/tests | Pi 0.81 + a hand-written `pi-coding-agent` shim | Pi 0.99.1 (the host version) |
| `src` size | 104,921 lines at upstream v0.75 | 76,699 lines (224 files); tests 99,426 lines |
| Unit tests | 3,082: 41 fail + one file that never finishes | 2,688: 0 fail, 12 skipped (env-gated) |
| Integration tests | 1,026: 14 fail | 988: 0 fail, 1 skipped (env-gated) |

The branch is `git log ad56bf92..wm/vendor/main` in
`~/Development/tools/pi-subagents` (worktree `~/Development/tools/pi-subagents-v075`).
`FORK.md` lists every behavioral delta and every removed subsystem.

## Established causes and fixes

1. **Failing and hanging tests came from the owner's uncommitted work, not from
   upstream or Hermes.** The work changed contracts (`pid` → `runnerPid`/`ownerPid`,
   `stale` activity state, opt-in run deadlines, acceptance `resume-required`,
   typebox as a peer) without updating tests. Proof: committed HEAD passed the
   same 18 files 548/548, and the reconstructed pre-Hermes tree failed the same
   41 tests. The hang (`readonly-drain-observation`) was a fixture still writing
   `pid`: the drain waited for a run whose liveness was unknown, and a 30-minute
   timer kept the process alive. **Fix:** the work was ported feature by feature
   onto v0.75 with its tests adapted (commits `8395af28` … `c731fde3`).
2. **The Hermes repair was 97 % reformatting.** Neutralizing formatting left
   41 files (+171/−192). 38 were behavior-neutral lint appeasement (fuzz-checked)
   and were dropped with the repo-wide oxfmt reformat, the oxfmt dependency, the
   lint/format scripts and `.npmrc install-links=false`. **Kept:** two real
   error-masking fixes (`259150d8`: a cleanup error in `withSlotClaim` and in
   `writeExplicitOutput` replaced the primary error) and one dead-code removal
   folded into the slash-command prune.
3. **The typecheck failure Hermes chased was a mixed npm/pnpm install**: pnpm
   copied the `file:` shim without its declarations. The shim is gone; the real
   Pi 0.99.1 SDK is used.
4. **Pi 0.99.1 API drift (found once typechecked against the host):**
   `steer`/`followUp` resolve to a disposition (`25660371`), and a user-only
   session is now persisted at once (fork test adapted).
5. **Real defects found by macOS-only failures:**
   - `82951c1e`: the native runner preload aliased host peers to non-canonical
     paths, so a symlinked location (macOS `/var`, pnpm stores) could load a
     second instance of a module. Alias targets now resolve through `realpath`.
   - Test-only races and portability: `9e016c49` (fixture wrote a polled
     control file non-atomically), `ed353a07` (FSEvents misses a file created
     right after `fs.watch`), `734b5a6d` (long macOS temp paths wrap in the Fleet
     pane), `783774aa` (a test inherited the owner's `~/.agents/skills` when run
     outside a git checkout).
6. **`--test-force-exit` silently drops tests** (unit count varied 2,644–2,688
   with 0 failures reported). It was removed (`3c442707`); `--test-timeout`
   stays (60 s unit, 120 s integration).

## Interfaces affected

- **Removed tool surface** (no observed use in 850 calls over 4 weeks): external
  CLI/job runners (`runner:` frontmatter now rejected), watchdog (the reviewer
  keeps `watchdog_diff`; permission `ask` now denies), prompt-template
  delegation, `schedule.*`, Herdr project panes and saved machines (`machine:`
  now rejected), the `subagents:rpc:v1` bridge, `refine*`, Orca tabs, chain
  mode / `tasks[]` / append-step / dynamic fanout / saved chains, run history,
  pi-web liveness, Gist `share`, upgrade notice, inspector registration, Ghostty,
  required child extensions, `subagent_command`, built-in MCP and MCP imports,
  prompt audit, `subagents_enable`, `disabledFeatures`, mission goal driver /
  decisions / workflow state (missions are explicit only), Worktrunk and
  `worktree.cleanup`, pi-intercom result delivery and the `intercom` notify
  channel, all `pi-subagents/*` package subpaths, the runtime agent and
  capability-ceiling registries, 6 slash commands (`/subagents-fleet` kept: the
  only TUI entry to Fleet since upstream removed Ctrl+Alt+F).
- **Changed contracts:** `status.json` and `subagent:async-started` carry
  `runnerPid` or `ownerPid` (no read-compat for old `pid`); `workflowScript` /
  `workflowScriptPath` are rejected — use `workflow: true | "<path>" | "<name>"`;
  `run-ci` accepts `pnpm test` / `pnpm run typecheck`; upstream removed
  `fallbackModels` and model exclusions (now rejected). New:
  `pi-subagents:agent-roster:v1`, `multi-issue-scout`, `parallel-gates`.
- **Owner-side changes made at cutover** (backups under
  `~/Desktop/pi/pi-subagents-maintenance-2026-10-02/cutover-backup/`):
  `settings.json` packages entry → `./packages/subagents`;
  `extensions/commands/simplify/lenses.ts` (`workflow: scriptPath`);
  `extensions/ui/renderers/package-presentations.ts` + `extensions/DESIGN.md`;
  `extensions/model/fallback/{command-filter,agent-roster,index}.ts`;
  `extensions/subagent/config.json` (`scheduledRuns` removed);
  `ARCHITECTURE.md`; root `oxlint.config.ts`, `oxfmt.config.ts`
  (`packages/**` ignored) and `package.json` (`oxlint --disable-nested-config`,
  because the package's own `.oxlintrc.json` otherwise overrides the root
  ignore); `~/.local/bin/pi-boat`, `~/.local/bin/pi-boat-apply.sh`,
  `~/.local/lib/pi-sync-lib.sh` (the Boat now syncs the vendored package to
  `/home/user/.pi-boat/packages/subagents`).

## Linter

No lint rule or linter implementation was changed. The anti-slop Oxlint plugin
(`.oxlintrc.json`, `tools/oxlint/anti-slop`) is upstream's optional guardrail:
upstream added it "without making the existing whole-repo baseline a default
lint gate" and v0.75 still has no `lint` script. The Hermes `lint`,
`format` and `format:check` scripts were removed with its reformat, on the
owner's decision. **Replacement for the requested commands:**
`npm run lint` / `npm run format:check` have no equivalent in the package; the
gates are `pnpm run typecheck`, `pnpm run test`, `pnpm run test:integration`.
The package is excluded from the `~/.pi/agent` root lint and format.

## Commands and results (logs: `~/Desktop/pi/pi-subagents-maintenance-2026-10-02/logs/`)

| Where | Command | Result | Log |
| --- | --- | --- | --- |
| history worktree | `pnpm run test` ×2, `pnpm run test:integration` ×2 | 2,688 / 0 fail; 988 / 0 fail, stable counts | `67-public-*` |
| isolated copy (`git archive`, no `.git`) | `pnpm install --frozen-lockfile`, `typecheck`, `test`, `test:integration` | all exit 0; 2,688 / 988, 0 fail | `70`–`73` |
| `~/.pi/agent/packages/subagents` | same four | all exit 0; 2,688 / 988, 0 fail | `86`–`89` |
| `~/.pi/agent` | `pnpm run lint`, `type-check`, `format:check` | exit 0 / 0 / 0 (380 files) | `90`–`94` |
| `~/.pi/agent` | `pnpm run test` | exit 1 by design: no `tests/` directory exists (pre-existing) | `95` |
| any cwd | `pi -p 'Reply READY'` | `READY`, no load errors | `96` |
| any cwd | live `pi -p`: guide, async `scout` + `bg_wait`, `workflow: "<path>"` | all three returned the expected value; runner used `runnerPid` and the vendored agent path | `97` |
| history worktree | `git diff --check ad56bf92 HEAD` | clean after removing 3 trailing blank lines left by merge resolutions | — |

Baselines kept for comparison: `00-*` (pre-work), `01-test-unit-baseline.log`
(hang; stopped after 28 min, recorded as failure), `06-` (integration),
`22-`/`23-` (pure v0.75), `64-`/`65-` (force-exit evidence).

## Test coverage actually exercised

- Full unit and integration suites as above, on macOS, Node 24.20.0,
  pnpm 12.8.1, host Pi 0.99.1. Skipped tests need opt-in environment variables
  (real external SDKs or paid smoke runs); none were enabled.
- No new test cases were written (owner policy). Existing tests were adapted
  only where they asserted a replaced contract, or deleted with a removed
  feature. **Not covered by a dedicated test:** the dead-`ownerPid` reconcile
  branch (F1), user-pin precedence over project/provider overrides (F7).
- Live behavior verified: result handoff, async completion and `bg_wait`,
  workflow by path. Not exercised live: `/simplify` end to end (interactive
  command), `pi-boat` on the remote Boat (validated offline only: syntax,
  manifest, archive content, path rewrite).

## Dependencies, configuration, installation

- Runtime dependencies: `acorn`, `jiti`, `undici`, `yaml` (exact pins). Host
  packages are optional peers (`pi-ai >= 0.99.1`); Pi's loader aliases them.
- `pnpm-workspace.yaml` makes the package its own workspace root (required under
  `~/.pi/agent`, which has its own workspace) and records `allowBuilds`.
- Install: `cd ~/.pi/agent/packages/subagents && pnpm install --frozen-lockfile`.
  Requires network access to the npm registry; installs `node_modules`
  (~212 MB) locally. Never use npm.

## Files a validation copy must include

The whole package directory except `node_modules`: `index.ts`, `src/`,
`test/` (incl. `test/support`, `test/fixtures`), `agents/`, `skills/`, `docs/`,
`README.md`, root `*.mjs` (`runner-peer-preload.mjs`, `runner-peer-loader.mjs`,
`async-retention-discovery-worker.mjs`, `inspector-runner.mjs`),
`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`,
`.oxlintrc.json` and `tools/oxlint/` (used by `test/unit/anti-slop-oxlint.test.ts`),
`.gitignore`, `FORK.md`, `SOURCE.md`, `AGENTS.md`, `LICENSE`. Tests isolate
`HOME`, temp roots and the cwd themselves; no other state is needed.

## Risks and open points

- **The vendored copy has no version control.** The owner declined chezmoi for
  now and keeps history local. Automated edits must happen in the history
  repository (`wm/vendor/main`) and be re-vendored per `SOURCE.md`; editing
  `~/.pi/agent/packages/subagents` in place leaves no reviewable diff.
- **Active Pi sessions** still run the old checkout until `/reload`; their
  status files already use `runnerPid`/`ownerPid` (the old working tree had the
  same split), so mixed sessions share state compatibly. A status file written
  by a build older than that split is never stale-repaired.
- **Children have no model failover** (upstream removed it; owner accepted).
- **The old checkout** `~/Development/tools/pi-subagents` keeps its uncommitted
  pre-repair state untouched; backups: `refs/backup/pre-maintenance-2026-10-02/*`
  (state before this work, Hermes included) and `refs/backup/owner-wip-pre-hermes`
  (owner work without Hermes).

## Before reintegration

1. Point the maintenance root at the history repository branch
   `wm/vendor/main` (not at the vendored copy) and add a re-vendoring step.
2. Replace its command list for this root with pnpm: `pnpm install
   --frozen-lockfile`, `pnpm run typecheck`, `pnpm run test`,
   `pnpm run test:integration`; drop `lint` / `format:check` for this package,
   and apply an outer wall-clock limit per command.
3. Remove the old path from `deferred_roots`. These edits belong to the owner;
   this work did not modify the cron job or `maintenance.json`.

## Addendum, 2026-10-04

Two things changed after this report was written. Where the sections above
disagree with this addendum, the addendum is right.

- **No git history any more.** At the owner's request the package is
  maintained in place in `~/.pi/agent/packages/subagents`. The local history
  repository, its `wm/vendor/main` branch and its worktree are gone, so every
  mention above of that branch, of a vendored commit, or of refreshing the copy
  with `git archive` is obsolete. FORK.md describes the current arrangement.
  For the daily maintenance this means the root to check is the package
  directory itself, with `pnpm run typecheck`, `pnpm run test` and
  `pnpm run test:integration`.
- **Shared output file fixed.** With `singleRunOutputBaseDir` configured,
  relative `output` paths resolved under that directory itself, so concurrent
  runs of an agent with a default `output` (`scout` and its `context.md`)
  wrote one file and each run could return a sibling's result. The behavior
  came from upstream. Relative outputs now resolve under
  `{singleRunOutputBaseDir}/{runId}/`, as they already did without the option
  (`resolveSingleRunOutputBaseDir` in
  `src/runs/foreground/subagent-executor.ts`). Two existing integration tests
  that asserted the shared path were adapted; no test was added. Gates after
  the change: type-check clean, unit 2,688 tests with 0 failures, integration
  988 tests with 0 failures.
