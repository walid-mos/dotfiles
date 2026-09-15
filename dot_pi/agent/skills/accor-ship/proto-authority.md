# Prototype authority — source, fidelity, limits

Extends the proto invariant one-liner in `accor-conventions` §3 and powers
`accor-ship` Phases 0–1–3; that one line is the summary — every mechanic below
is single-homed here.

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
assets and markup; open the deployed URL as the visual reference of control. Do
not add the proto as a dependency and do not leave it lying around in the repo.

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
2. **Reimplement, don't copy.** Inspect the source to understand the rendering;
   rewrite it in our stack (React + TS + repo conventions), clean, testable,
   SOLID. Freedom is limited to internal architecture, maintainability,
   performance, backend integration, and replacing data hacks — **without
   observable drift**.

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
