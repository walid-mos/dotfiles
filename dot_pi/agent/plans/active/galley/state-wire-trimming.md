---
id: galley/state-wire-trimming
title: Trim the browser state payload
project: galley
status: review
created: 2026-09-14
updated: 2026-09-14
---

# Trim the browser state payload

**Implemented; ready for human code review on 2026-09-14.** Full-repository gates have unrelated pre-existing blockers, detailed below.

## Goal

Make large desks faster to open and refresh by sending the browser only the review information it needs. Keep the review experience, saved decisions, staging, comments, and agent handoff unchanged.

In plain English: **send the review's index, not another copy of every diff line.** The browser already loads file contents separately when it needs to display a file.

## Context

The supplied benchmark reports a roughly **125 MB** state response and **3.9 s** to first rows on the large fixture; medium transfers **28 MB**. Treat the proposed **~1 s** large cold open as a hypothesis to test, not a guaranteed outcome. These measurements have not been rerun for this draft.

Code inspection at `afce4c4` confirms:

- `GET /api/state` serializes the entire backend state, including `rawDiff` and every file's parsed hunks.
- The UI does not read the backend's `rawDiff`. Its renderer builds its own diff from the separately fetched old/new file contents.
- **The UI does use backend hunks in more than one place:** Markdown chooses Rendered/Source from their presence; completion statistics count their changed lines; walkthrough counts have a hunk fallback. Remove these dependencies before removing the payload.
- `POST /api/reset` also returns the entire backend state. Slim this response too, or Reset will bring the heavy objects back into the tab.
- `/api/poll` is already a small heartbeat. Keep its cadence and normal payload small; add the approved refresh notification for a reconnected tab.
- The backend still needs the full diff for staging and reconciliation. This is a transport change, not a persistence migration.

### Scope

**Include:** a browser-specific state shape, a small server projection, migration of the affected UI readers, both state-returning responses, contract documentation, regression tests, and before/after measurements.

**Exclude:** worker parallelism, tokenization changes, bundle splitting, virtualization, cache redesign, pagination, compression, and lazy loading of change records. Those address different costs and should not obscure this improvement.

## Approach — phases in order

### 1. Agree on what crosses the boundary

Define `BrowserReviewState` and `BrowserReviewFile` in `src/types.ts`, alongside the existing backend types. Reuse shared field types rather than duplicating their definitions. Keep the backend `ReviewState` unchanged.

| Information | Proposal | Reason |
| --- | --- | --- |
| Review identity used by the screen | Keep `root`, `session`, `mode`, `target`, `staged`, `baseDiffHash` | Titles, review mode, staging rules, reload detection |
| File summaries | Keep paths, content hash, change kind, added/removed counts, rename/oversized flags, optional size | Navigation, counts, rendering decisions, cache invalidation |
| Parsed hunks | Replace with required `hasHunks: boolean` | Preserve Markdown's current default without shipping diff lines |
| Reviewer records | Keep changes, decisions, comments, approval hashes/lists, staging lists, decision-file list | Preserve review behavior and the existing save slice |
| Guide and live agent status | Keep them; keep status outside the stored browser review | Guided review and agent presence remain unchanged |
| Raw diff and backend-only metadata | Omit `rawDiff`, `id`, `repoHash`, `head`, `base`, state timestamps, `persistFile` | No current UI reader; preserve these on the backend |

Make added/removed counts reliable at the browser boundary using the existing builder's stamps. Do not recompute line totals or read file contents on every state request. Check alternate file builders, reloads, restored desks, and preview-file construction before making counts required.

Use an **explicit allowlist** when building the response, rather than spreading the backend state and deleting a few fields. Future backend fields must not silently become browser payload.

**Gate:** every retained field has a consumer or a stated contract reason; every removed field has no remaining browser dependency. Distinguish backend `DiffHunk` objects from the renderer's own hunks, which stay untouched.

### 2. Switch the server and browser together

- Add one pure, synchronous projection from backend state to browser state. Share it between `GET /api/state` and the nested `state` in `POST /api/reset`.
- Preserve the existing staged-snapshot refresh, mutation serialization, and live-status handling. Never delete fields from the authoritative state or its files.
- Retype the browser store, initial fetch, reload, reset, previews, and affected helpers against the browser shape. Do not use casts to pretend the slim payload is a full backend state.
- Replace Markdown's `hunks.length > 0` with `hasHunks`. Read walkthrough totals from the supplied counts and remove its obsolete hunk fallback.
- Preserve completion-receipt totals exactly: today a hunkless whole-file addition contributes zero lines there, even though its sidebar additions count is nonzero. Use the summary plus `hasHunks` to preserve that distinction; changing it would be a separate behavior fix.
- Leave per-file contents fetching, rendered hunks, decision replay, anchors, save/send ownership, and `ReviewResult` unchanged.

**Gate:** backend and UI typechecks pass; both HTTP responses exclude the heavy fields; the same operations still work with the slim state.

### 3. Lock down behavior and document the boundary

Write failing contract tests before changing the response, then make them pass. Cover:

- Large `rawDiff` and hunk-line sentinels never appear in either response; the backend still retains them afterward.
- Required fields and meaningful zero/false values survive projection, including an empty desk after reload.
- Markdown defaults and line totals match the current behavior for modified, added, deleted, hunkless, and pure-rename files.
- Initial load, reload, and Reset all adopt the same browser shape.
- Accept/reject, approval/staging, comments/questions/replies, guides/skims, and save/send still preserve their current records and semantics.

Update the existing concurrency regression: it currently checks `hash(rawDiff)` through `/api/state`. Keep that invariant checked against the backend or persisted snapshot and compare its hash with the public response; do not simply remove the assertion.

Update `src/spec.ts` and its contract tests to explain that browser state is a projection, not the persisted review. Clarify that CLI events and `ReviewResult` have not changed. Strengthen the existing non-browser performance smoke check to reject `rawDiff` and per-file `hunks` on the wire.

**Gate:** focused regressions and the repository's lint, type-aware lint, formatting, typecheck, test, build, and performance-smoke gates pass.

### 4. Measure the actual improvement

Use identical fixture contents, build settings, browser conditions, and initial review state before/after. Run at least three cold opens per fixture; report medians and ranges. Exercise a changed-diff reload separately from a browser refresh.

Prioritize **medium and large**; use **tiny** as the overhead check and **bigfile** to verify the oversized-card path still works. Restore fixture state between runs so accepting changes cannot bias the next measurement.

Measure state-response bytes and request time, first real rows, reload-to-updated-rows, and comparable browser heap readings. Report the oversized card separately from actual diff rows, and themed tokens separately from first rows. Do not attribute worker or DOM-cache costs to this change.

Use `pi-frontend-check` for all browser checks and benchmarks; do not run the repository's standalone Playwright browser driver. Use the existing fixture generator and non-browser checks where appropriate.

**Gate:** report the measured payload and timing changes with no functional regression. Do not impose a byte-reduction percentage or timing target; the reviewer explicitly requested measurement without a blocking performance goal. Keep unrelated optimizations separate.

## Files touched

| Area | Expected files |
| --- | --- |
| Shared contract and projection | `src/types.ts`; a small `src/server/browser-state.ts` plus focused tests |
| HTTP responses | `src/server/routes/desk.ts`, `src/server/routes/review.ts` |
| Browser shape and adoption | `src/ui/types.ts`, `main.ts`, `store.ts`, `poll.ts`, `save.ts`, `bindings/dialogs.ts`, `bindings/navigate.ts`; other type-only consumers as required |
| Hunk-dependent UI behavior | `src/ui/mdfile.ts`, `progress.ts`, `walkthrough.ts`, and focused tests/fixtures |
| Contract and regression gates | `src/spec.ts`, `src/spec.test.ts`, relevant server tests, `scripts/perf-smoke.mjs` |

Keep changes limited to this boundary. No dependency, persisted-schema, version, or changelog edits.

## Risks / open questions

Approved decisions from the recovered Galley review:

1. **Include Reset.** Apply the same slim projection to both response paths.
2. **Preserve today's completion counts.** Do not change hunkless-file totals in this optimization.
3. **Send a refresh event.** Detect a restarted desk through the existing heartbeat before adopting another state shape. Show a persistent, non-destructive refresh-required notice; the reviewer refreshes explicitly after finishing actions and preserving unsaved text. Do not force navigation during stage/unstage/Send requests. Guard Reset's state adoption as well as GET state. Bundles predating this mechanism cannot handle a new event retroactively and need a manual refresh when first upgrading.
4. **Do not impose performance goals.** Measure and report the optimization without blocking on ~1 s or an 80% reduction. This change does not fix worker tokenization or DOM-cache memory.

## Verification

| Check | Outcome | Status |
| --- | --- | --- |
| Field-consumer audit and browser contract | Explicit top-level/file allowlists; no missing consumer found by independent review | Passed |
| State and Reset exclusions; backend preservation | Contract tests exclude raw diff/hunks and retain backend originals; nonempty reviewer/guide records pinned | Passed |
| Functional and concurrency regressions | 268 tests passed; includes real empty reload, metadata-derived views/counts, and backend/public hash parity | Passed |
| Build, performance smoke, formatting | All passed; smoke state payload 480,445 bytes, startup 324 ms, reload 266 ms | Passed |
| Type-aware lint for this change | All files listed in the evidence ownership manifest passed | Passed |
| Full-repository lint/type checks | Blocked only by the pre-existing files listed below | Existing blockers |
| Browser flows | Initial load, pending stage/Send, Reset, foreign-instance Reset, changed-diff reload, real restart with draft retained | Passed |
| Rendering | Notice checked at 1280×900 and 390×844; wide DOM geometry/styles unchanged by formatting; zero console errors/warnings | Passed |
| Performance measurements | Payload and parse cuts confirmed; no meaningful first-row improvement in these samples | Recorded below |
| Post-browsing heap / tokenization | No comparable retained-heap or themed-token rerun; do not claim improvements | Not measured |

**Delivery:** one coherent implementation change, a before/after results table with evidence, and a Galley code review.

### Execution — 2026-09-14

- Use test-first for the HTTP payload and refresh contracts; keep the UI type migration at refactor pace.
- Preserve pre-existing working-tree edits in dependencies, renderer files, and `src/agent/`. Baseline patch and build are captured under `/tmp/galley-state-wire-evidence/`.
- Baseline `pnpm build` passed before implementation.
- Independent review found two refresh hazards: automatic reload during an in-flight reviewer action, and Reset bypassing the instance check. Both were fixed by the persistent notice and shared instance guard; a bounded follow-up confirmed both findings resolved.
- Pre-existing tracked edits in `extensions/galley.ts`, `package.json`, `pnpm-lock.yaml`, and the three renderer files match the captured initial patch byte-for-byte.

### Measured results — 2026-09-14

State sizes below are actual UTF-8 response bytes (decimal MB). Both builds used identical isolated fixture copies, including each fixture's extra README entry. Browser timings are medians of three **fresh iframe UI instances**, with HTML fetched before the early injected probe. HTTP cache may warm; these are controlled application-start measurements, not a claim of cold network/navigation timing. First rows and themed tokens remain separate.

| Fixture | State bytes before → after | Reduction | JSON parse median before → after | First-row median before → after |
| --- | --- | --- | --- | --- |
| Tiny | 191,323 → 23,150 | 87.9% | 0.2 → <0.1 ms | 241 → 230 ms |
| Medium | 28,988,186 → 3,167,313 | 89.1% | 22.9 → 5.6 ms | 785 → 797 ms |
| Large | 127,680,804 → 13,874,611 | 89.1% | 111.8 → 11.5 ms | 3,716 → 3,731 ms |
| Bigfile | 5,920,810 → 554,928 | 90.6% | 4.3 → 0.5 ms | 403 → 414 ms |

First-row ranges: tiny 214–298 → 216–296 ms; medium 779–819 → 788–800 ms; large 3,648–3,840 → 3,697–3,758 ms; bigfile 390–503 → 394–451 ms. Bigfile's summary-card median was 202 → 186 ms; the probe then clicked “Load diff anyway” and timed actual rows separately.

**Conclusion:** the transport/parse improvement is real, but the estimated ~1 s large first-row result did not materialize. Retained change records still dominate the remaining response (52,500 changes on large), and rendering/startup work remains outside this slice. No performance target was used as a release gate.

A real changed-diff reload on tiny reached the new row in 1,022 ms, including the heartbeat delay, retained the selected path, and adopted only the slim state. Heap samples are available but not GC-normalized and are not evidence of reduced retained memory after browsing.

### Remaining gate blockers

- `pnpm check`: pre-existing `src/agent/desk-listener.test.ts:11` uses `Promise.withResolvers` with an older configured TypeScript library.
- Full lint/type-aware lint: pre-existing violations in `src/agent/*`, `src/ui/render/render-signature.test.ts:129`, and `scripts/browser-bench.mjs:346`. This change's scoped type-aware lint is clean.
- Existing narrow topbar overflow can occur with the long no-agent status. The new notice is viewport-bounded and readable; the unrelated topbar layout was not redesigned.

### Evidence

- `/tmp/galley-state-wire-evidence/`: `pre-existing.patch`, `owned-files.txt`, `gate-results.json` and per-gate logs, `wire-bytes.json`, `browser-samples.json`, `browser-extra-samples.json`, `frontend-checks.json`, and the reproducible `frame-bench.js` expression used through `frontend_eval`.
- Independent review/follow-up: `/Users/walid-mos/.pi/agent/sessions/--Users-walid-mos-Development-tools-galley--/subagent-artifacts/outputs/a5b7ae4e-38dd-4616-adaa-f022d72815af/wire-review.md`.
- No commit, staging, version bump, or publication performed.
