---
name: accor-ship
argument-hint: "<feature description> [ticket ref] [--base <ref>] [--no-worktree] [--max-files <n>] [--max-lines <n>] [--no-stack] [--stop-before-pr] [--dry-run]"
description: >-
    Deliver a Menu Compliance feature (front @astore/menu-compliance + API
    @astore/api) in the Accor monorepo product-data-apps as a stack of readable
    PRs, ticket/prototype as source of truth and a numbered acceptance matrix
    with per-AC proof. Use when the user asks to deliver a Menu Compliance
    feature in this repo ("accor-ship", "livre cette feature", "ship la feature
    menu compliance"), or describes such a feature to build or change,
    including dev/demo widgets in the Menu Compliance UI.
---

# accor-ship — Menu Compliance feature delivery

Deliver a **Menu Compliance** feature in the Accor monorepo
`product-data-apps`, in **readable stacked PRs**, with the Accor product context
frozen: perimeter, prototype source, and integration rules are given — the user
provides only **the feature** (and a ticket when there is one).

**Precondition**: load `~/.pi/agent/skills/accor-conventions/SKILL.md` first —
its git naming (§1), perimeter (§2), baseline & commands (§4), and REST recipes
(§5) govern here and are not restated.

**Sub-files (load on demand)**:
- `proto-authority.md` — prototype source, 1:1 fidelity, hard limits of proto authority (schema/business decisions), the persisted coverage manifest, and the deterministic pixel gate. Load before Phase 0, whenever a front rendering decision is made, and before building the manifest or running the visual gate.
- `stack-contract.md` — slicing defaults, link mechanics without gh-stack, fix-on-origin + restack, stacked PR creation. Load at Phase 2, re-apply at every mid-run split.

## Arguments

    accor-ship <feature description> [ticket ref] [options]

- `<description>` (required) — the feature to deliver. With the ticket, it is the
  **functional / product** source of truth.
- `[ticket]` — link, identifier, or pasted text. Read it entirely before writing
  code; never invent its content from memory.
- Defaults: `--base develop`. Soft ceilings: `--max-files` 20, `--max-lines`
  1000 (semantics in `stack-contract.md`). `--no-stack`: deliver as one branch +
  one PR. `--stop-before-pr`, `--dry-run`: stop after local verification, or plan
  only. **`--no-chrome` does not exist** — every front delivery requires the
  visual comparison.

## Phase 0 — Orient

- Read the repo's local agent docs for the apps touched (`apps/api/`,
  `apps/menu-compliance/` — AGENTS.md / CLAUDE.md).
- Ticket via the REST recipes (accor-conventions §5). **Every spec link the
  ticket cites is read through the Confluence REST API** with the `accor`
  profile; an unreadable link is an explicit blocker, never a reason to skip.
- Inventory the repo with `git ls-files`: modules touched, existing patterns,
  test setup.
- Prototype: clone/inspect per `proto-authority.md` — before any implementation.

## Phase 1 — Reconcile & build the acceptance matrix

Do all of this **before** the delivery loop. Ask the blocking questions now
(via `ask_user_question`) — after this phase, no more questions except hard
blockers (proto-derived schema, out-of-perimeter need).

Build a **numbered and exhaustive acceptance matrix** as a
**scope-specific coverage manifest** (row format, citations,
role/workspace/boundary dimensions, evidence rules: `proto-authority.md` §
Coverage manifest). Summarize it in the transcript; transcript-only coverage
is not accepted. One row
per observable or business requirement, including informative non-interactive
content (labels, previews, counters, pre-filled values, disabled/readonly
states, per-segment/role variants). Every row contains:

- a stable id (`AC-01`, `AC-02`, …) and its exact source (ticket, spec section,
  proto state/route);
- the precise expected result;
- the surfaces and variants concerned;
- the required final proof: an existing automated test, a command/API call, or
  a flow + DOM assertion + zero-delta `frontend_pixel_diff` with both capture
  names at the same viewport — never a test you wrote.

Run a **reconciliation pass ticket ↔ spec ↔ prototype ↔ matrix**: every
requirement found appears in the matrix; every divergence is resolved by source
authority (ticket/spec for business, proto for in-scope visuals) and recorded
in the manifest. Any business
decision that appears only in proto code is an **hypothesis to validate with the
user**, never a fact to record (`proto-authority.md`).

State blockers openly. The matrix is the delivery engine: exit is per-row proof,
nothing else.

## Phase 2 — Slice the stack

Load `stack-contract.md` and apply its defaults with these Accor constraints on
top (constraints, never a second slicing algorithm):

- Menu Compliance perimeter (accor-conventions §2);
- every AC allocated to at least one link — after slicing, verify **no orphan
  AC**: an unallocated AC blocks implementation;
- proto 1:1 only on ticket surfaces/states (front only), and no schema derived
  from the proto (`proto-authority.md`);
- api layout conforms to the clean-arch contract (§7 below);
- branch naming per accor-conventions §1, never with a stack index — the
  parent-child chain lives in the raised-on-top branches, not in names.

## Phase 3 — Link loop (local execution)

For each link, in stack order:

1. **Branch** — first link from `--base` (`develop`), each next link on top of
   the current tip; in `--no-stack`, one branch from `--base`.
2. **Implement** — front and API code locally, in parallel where useful; on the
   api, respect the clean-arch layout (§7); on the front, restructure the
   proto's logic while preserving its markup, CSS and assets where they already
   match (`proto-authority.md`).
3. **Test for real** — after all changes for the link, submit independent
   affected-package build/typecheck/lint/test gates through the generic
   `parallel-gates` workflow once (accor-conventions §4). The workspace-wide
   baseline runs once in Phase 4. Red = the link does not advance; fix directly,
   no new loop.
4. **Visual comparison (mandatory for front links) — deterministic pixel
   gate.** Start `pnpm dev:compliance`; per state, capture the deployed proto
   and the local app, then diff them (`frontend_capture_pixels` /
   `frontend_pixel_diff`); **zero changed pixels at equal viewport/browser/
   fonts/data** is the pass condition (full mechanics, selector scoping and
   exclusions: `proto-authority.md` § Pixel gate).
   - Assert exact copy (text, placeholder, aria-label, states) via DOM
     evaluation; every capture/diff artifact is recorded as evidence in the
     coverage manifest row for that state; console clean.
   - A state that cannot be captured and diffed is **blocked and reported** —
     never claim parity for it. Ignore deltas outside the ticket (features out
     of scope, third-party UI/scripts requested by the PO, the local
     impersonation switcher) — via declared selectors/exclusions, never by
     hiding in-scope pixels.
   - Pure back/infra links are exempt — say so explicitly.
5. **Self-review pass (per link)** — re-read the link diff under the `coding`
   skill's minimum-change lens (delete/simplify/reuse before adding; verify each
   candidate against the link's green baseline; revert any cleanup that breaks
   it; one verified set at a time). Fixes land as their own atomic commits.
6. **Next link** — branch on top and repeat. Mid-run split required: re-apply
   `stack-contract.md` and continue in the new link (say so in the report).

## Phase 4 — Global pass & submit

1. **Global self-review pass** — same coding lens across the whole stack diff:
   cross-link overlap, drift between similar patterns, scope and API alignment.
   A fix that concerns a lower link is applied **there** (fix-on-origin) and the
   chain rebased + re-tested (`stack-contract.md`).
2. **Final verification** — full suite green across the stack; re-run the visual
   comparison on UI paths the global pass touched.
3. **Submit** (unless `--stop-before-pr` / `--dry-run`) only when every in-scope
   manifest row is proven. A blocked row prevents submission; report it and
   resume when unblocked, or obtain explicit approval for a reduced scope.
   Before each push, obtain the user's approval for that exact branch and remote
   (`~/Development/clients/accor/AGENTS.md`). Then create stacked PRs bottom-up
   per `stack-contract.md` §Stacked PRs. Each PR body **strictly** follows
   `.github/PULL_REQUEST_TEMPLATE.md` (Ticket — or the explicit in-Summary
   justification of its absence —, Summary, Scope checked, Changes, How was this
   tested?, Checklist). Never a free-form body; check each body against the
   template before declaring submit finished. In `--no-stack`, the same template
   discipline applies to the single PR.
4. **No auto-merge.** Merging the stack is an explicit human gate.

## Execution discipline (runs inside the goal loop)

- Keep going turn after turn until the exit conditions are met; one verifiable
  step per turn; **prove, don't declare**. The goal loop drives pacing; these
  exit conditions — not a turn count — decide when the run stops.
- Green tests, a passing main flow, or "the UI looks compliant" are never proof
  of matrix coverage: each manifest row needs its own checkable evidence.
- No user questions after Phase 1 sign-off except hard blockers.
- **Delivery exit conditions (all required)**: each `AC-01…AC-N` proven
  individually with no omitted/unverified/blocked row; the persisted coverage
  manifest complete and attached (sources, role, PME/L&L workspace, boundaries,
  replayable evidence per row); stack submitted from `develop` (unless
  `--stop-before-pr` / `--dry-run`, or push approval is pending); ticket Done;
  suite green; both self-review passes done; pixel gate (zero changed
  pixels) for every surface/state/variant in the manifest at the same
  viewports with DOM assertions and recorded diff artifacts; uncomparable
  states reported, never claimed; exclusions listed openly;
  `apps/product-benchmark` untouched; PR descriptions template-compliant.

## Definition of done

- The acceptance matrix built from the ticket, **all** of its linked spec
  sections and the prototype is complete; every AC allocated, implemented and
  proven individually. Run a final reconciliation pass ticket ↔ spec ↔
  prototype ↔ matrix ↔ diff/tests to catch omissions.
- No criterion counts as covered by proximity: a business gate does not prove
  the associated informative preview, and a passing submit test does not prove
  a modal's labels, pre-filled values or readonly states.
- The persisted coverage manifest is complete: every reachable in-scope outcome
  (per role, per PME/L&L workspace, with empty/error/disabled boundaries)
  cited to its source, with replayable per-row evidence. A blocked row prevents
  submission until unblocked or explicitly removed from scope by the user.
- The feature is delivered in full; blocked work is reported as incomplete,
  not shipped as if it passed.
- No DB schema, API contract, or business decision derived from proto code; any
  proto-sourced business hypothesis validated by the user in Phase 1.
- Front rendering proven **1:1 vs the deployed proto** on ticket surfaces/states,
  same desktop viewports (addresses in `proto-authority.md`), via the pixel gate
  (zero changed pixels) with diff artifacts recorded in the manifest;
  out-of-scope deltas excluded via declared selectors; uncomparable states
  blocked and reported; proto logic restructured clean, its markup/CSS/assets
  preserved where they already match.
- `apps/product-benchmark` untouched.
- Sliced per `stack-contract.md`; every link compiles and tests green alone;
  several atomic commits per link.
- `pnpm test`, `pnpm lint`, `pnpm typecheck` green across the stack — real
  output (accor-conventions §4).
- Self-review passes done **per link then globally**, fixes committed and
  tested.
- Stack submitted from `develop` (stacked PRs), except `--stop-before-pr`;
  every PR description template-compliant.

## Final report

One line per link: branch, ACs covered, files/lines vs the soft budgets, number
of commits, PR URL. Manifest status per row (proven/blocked). Pixel-gate
coverage (states captured, diffed, exclusions declared, uncomparable states)
and what remains open. Path of the persisted coverage manifest. No code recap.
