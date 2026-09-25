# Prototype authority — source, fidelity, limits

Extends the proto invariant one-liner in `accor-conventions` §3 and powers
`accor-ship` Phases 0–1–3; that one line is the summary — every mechanic below
is single-homed here. Also single-homes: the **scope-specific coverage
manifest** (§Coverage manifest) and the **deterministic pixel gate**
(§Pixel gate) that accor-ship requires.

## Prototype source & asset retrieval

**Ticket / spec**: delivered scope + authority on **backend / business**.
**Prototype**: the only truth for **visual rendering** and **observable front
behavior** *within that scope* — not the whole app.

- Deployed: `https://drinks-menu-compliance.vercel.app` (alternate deployment:
  `https://drinks-menu-compliance-vite.vercel.app`)
- Source: `https://github.com/Alexdu13/drinks-menu-compliance` — the actively
  pushed fork; original: `https://github.com/VianneyBertrand/drinks-menu-compliance`

**Always** clone and inspect the source repo and its assets **before**
implementing. Never derive the rendering from memory; never copy the code blind.
Clone into a scratchpad (`git clone --depth 1`) or read via `gh`/web to inventory
assets and markup; open the deployed URL as the visual reference of control.
Record the resolved repository URL and source commit plus the deployed URL and
observation time in the coverage manifest. Verify the deployment corresponds to
that source revision where possible; if it cannot be proven, the deployed pixels
remain authoritative and source-only states are not automatically treated as
shipped states. Do not add the proto as a dependency or leave it in the repo.

**1:1 fidelity is mandatory only for surfaces and flows in scope.** On the
ticket's perimeter: pixel-perfect, colors, spacing, typography, responsive
layout, states, animations, screen behaviors identical to the deployed
prototype. No interpretation, no visual "improvement". Compare local and proto
at the **same viewports**. Menu Compliance is **desktop web-only**: never
implement or validate mobile; compare local and proto at the same **desktop**
viewports. Deltas out of scope are **ignored**: features outside
the ticket, third-party UI/scripts requested by the PO, the local impersonation
switcher. In doubt about a rendering **inside the ticket scope**, the deployed
URL decides — not the code, not taste.

## Two opposing rules

The prototype was produced by an LLM: rendering and observable behavior are
exactly what we want on the ticket scope; the code is very poorly written.
Draw both consequences:

1. **1:1 visual and behavioral fidelity on the ticket surfaces/flows.** Retrieve
   the visual assets this scope requires — images, icons, SVG, fonts, color
   tokens, spacing, layout structure. CSS/outcome (computed rendering,
   responsive, states, animations) indistinguishable from the deployed proto.
2. **Reimplement, don't copy — selectively.** Restructure what is code:
   logic, state management, data flow, backend integration — rewritten in our
   stack (React + TS + repo conventions), clean, testable, SOLID. But do not
   gratuitously rewrite what already renders right: **preserve the proto's
   markup, CSS and assets** (images, icons, SVG, fonts) where they match the
   target rendering — port them as-is instead of re-authoring equivalents.
   Copying a component wholesale with its hacks is still forbidden; copying a
   stylesheet value, an SVG or an image file is expected. When shared
   `packages/ui` tokens conflict with an in-scope prototype screen, use
   app-scoped styles; never change shared tokens for unrelated apps. Freedom is limited
   to internal architecture, maintainability, performance, backend
   integration, and replacing data hacks — **without observable drift**.

## Authority limit — front-observable ONLY

The proto's authority stops at **what displays and behaves on screen**: pixels,
layout, labels, states, animations, interactions. Everything else in the proto
is vibecoded and **has no authority**: backend, API, hooks, stores, and above
all **the data model / database**.

- **FORBIDDEN** to derive from the proto a DB schema, columns, persistable
  defaults, a business rule, or a product decision read in its hacks
  (`src/lib/*`, debrief comments, fixtures, localStorage). The proto shows *what
  the screen displays*, never *how it is stored*.
- Backend sources of truth: **the ticket/the spec**, the repo architecture docs
  (`AGENTS.md`), and what already exists in the database. The data model is
  designed from the need, not from the proto's types.
- Any business decision that appears only in proto code (rating-scheme
  structure, values, edge cases, persisted vocabulary) is an **hypothesis to
  have validated by the user in Phase 1** — via `ask_user_question` — before it
  is committed to a DB schema or an API contract. Cite its source; never present
  it as given.
- Legitimate reads of the proto for the backend: the displayed labels and the
  shapes of the screens, to size the DTOs *after* the model is validated.

## Coverage manifest — persisted, scope-specific

The acceptance matrix is not transcript-only: it is persisted as a
**scope-specific coverage manifest** — `apps/menu-compliance/acceptance/<ticket-or-feature-slug>.md`, created in Phase 1, kept in the delivered branch, its path stated in the final report.
Mechanics:

- **One row per reachable in-scope outcome**, each with:
  - a stable id (`AC-01`, …) and **source citations**: the exact ticket ref,
    Confluence spec section (with page anchor), and/or proto state/route URL
    the row comes from;
  - the precise expected result and the surfaces/variants concerned;
  - **role** — every role that can reach the outcome gets its own row or an
    explicit same-behavior citation;
  - **workspace** — PME and L&L each covered: a business display that differs
    by workspace is one row per workspace, an identical one cites both;
  - **boundary kind** — nominal, plus the empty, error and disabled/read-only
    states whenever they are reachable for that outcome;
  - **checkable evidence** — the exact command, API call, DOM assertion or
    pixel-diff artifact (with its artifact path / output) that a reviewer can
    re-run; never "verified visually in the transcript".
- **Inventory from the prototype's existing scenarios**: enumerate every
  in-scope route and each demo-control value/conditional branch from the proto
  source, including seeded datasets, fixtures and existing browser scenarios.
  Give each inventory entry a manifest row or a cited out-of-scope exclusion;
  reconcile counts before implementation and again at delivery. Never infer
  completeness from one nominal PME or L&L journey. An in-scope reachable
  outcome absent from both proto and ticket is a Phase-1 blocker/question,
  not a silent omission.
- **No authored tests** (global policy): evidence is existing automated tests,
  commands, API calls, DOM assertions and pixel-diff artifacts — never a test
  written for the manifest.
- **Spec authority vs proto rendering**: business semantics of a row (data,
  rules, role/workspace behavior) come from ticket + spec; what the state
  *displays* comes from the proto. A conflict between the two is recorded as a
  row divergence and resolved by source authority (spec for business, proto
  for in-scope visuals) — never silently.
- Rows carry a status: `proven` (evidence attached) or `blocked` (reason).
  A blocked row is reported as incomplete and prevents PR submission until
  resolved or explicitly removed from scope by the user.

## Pixel gate — deterministic visual parity

Applies to every in-scope surface/state. The browser extension tools
`frontend_capture_pixels` and `frontend_pixel_diff` are required; if they are
unavailable, delivery is blocked rather than downgraded. Fail-closed:

1. **Capture per state**: navigate local and deployed proto to the same
   state, then `frontend_capture_pixels` on each with a state-specific
   `wait_for` locator — same viewport, same browser, same fonts, same data.
   `body`/`html` readiness does not prove the scenario rendered.
2. **Diff**: `frontend_pixel_diff` of the proto capture against the local
   capture; **zero changed pixels is the pass condition**. Any changed pixel
   = the state is not done.
3. **Scope the capture**: the same strict selector on each page limits the
   capture to in-scope DOM, excluding out-of-scope chrome (third-party
   UI/scripts requested by the PO, the local impersonation switcher). Record
   each exclusion and its reason in the manifest. The pixel tool has **no mask
   support**: if an in-scope region cannot be compared without hiding pixels,
   block it rather than crop away the difference.
4. **Uncomparable state**: if a state cannot be captured and diffed (tool
   absent, state unreachable, capture fails), it is **blocked** — reported
   explicitly in the manifest and final report with the reason. **Never claim
   parity** for an uncomparable state, and never fall back to eyeballing
   screenshots as a substitute proof.

Record capture names, viewport, selectors, reproduction actions, tool output
and artifact paths in each manifest row. Captures live under
`~/.pi/agent/frontend-check/pixels/`; retain or attach them to the review,
not the repository. A reviewer replays the manifest to regenerate evidence.
