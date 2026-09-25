---
name: accor-wording-audit
description: >-
    Character-exact FR/EN wording audit of @astore/menu-compliance against the
    drinks-menu-compliance prototype. Use for "audit le wording", "check le
    drift de wording", or before shipping an i18n-heavy Menu Compliance feature.
    Diff-scoped unless the user explicitly asks for the whole app. NOT for
    general i18n plumbing or translation refactors.
---

# accor-wording-audit — wording drift vs the prototype

Compare the **final visible string for the same UI element**, in both languages,
not just the two locale files. The prototype is the source of truth; a mismatch
is fixed or accepted with evidence. Read `pipeline.md` for the scope, row
contract, commands and review protocol before running the audit.

## Work limit and coverage

- A feature/branch audit covers changed locale keys **and** keys whose rendered
  composition, usage, or counterpart changed, plus new user-visible literals.
  Prove that set from the diff before assigning work. A request for **all**
  wording covers every catalog key and user-visible literal, including unused
  keys; do not substitute a diff audit for a full request.
- Run the catalog fast pass first: extract both prototype dictionaries,
  inventory every app key, auto-identify unique bilingual literal matches,
  and ask Jev to select among shortlisted prototype entries for the rest.
  This is **candidate discovery, not a wording verdict**: validate every
  proposed same-element pairing against source usage before accepting it.
  Review differences, low-confidence and no-match choices in depth: Jev's
  `candidate_text_differs` is not proof that a counterpart exists, and `no_match`
  is not proof that one does not. Separate verified app-only features from
  unused or unintended wording before accepting anything. See `pipeline.md`
  for the review categories and gate.
- Batch by component/feature and reuse its inspected source across keys and
  languages. Start with one reader per independent surface, not one per key or
  an arbitrary fixed number of children. Pass the previous closed report to
  `catalog-prepare --cache`: unchanged, source-fingerprinted approvals skip
  Jev and component readers. A Jev suggestion or historical row alone is
  never an approval. See `pipeline.md` for capture and invalidation.
- The final-string gate checks complete row coverage. Byte-exact confirmed
  pairs cost no API calls; no-pair rows go straight to review; unchanged
  judgments can be reused. Jev is a triage signal, **not proof of pairing**:
  a confident choice passes only when the cited same-element mapping and
  composition are verified. Never mark an unknown or malformed judgment as
  passed.
- Report key and pair counts, requests actually sent to Jev, cache reuse,
  flagged and reviewed counts, elapsed time where available, and exclusions.
  Stop on incomplete coverage, unreadable prototype, or invalid gate output;
  never silently replace a missing pair with a convenient nearby element.

## Flow

1. Pin both revisions; run the full-catalog fast pass and account for
   prototype dynamic entries and JSX literals separately.
2. Verify proposed element pairings using component usage; inspect
   low-confidence, unpaired and different strings in depth. Do not accept an
   exact literal match merely because the words coincide.
3. Produce final-rendered rows for the proven scope, including composition
   and plural forms. Validate coverage; fix true same-element drift and record
   justified extras separately from unnecessary or uncertain wording. Close
   the catalog review only when every key has a cited element and decision;
   unresolved categories keep the gate red.
4. Rebuild changed rows from current source and compare them offline. Use Jev
   only for unresolved composition, reusing unchanged judgments. Report
   remaining accepted exceptions and run existing app checks for changed files.

For corrections in product-data-apps, follow
`~/.pi/agent/skills/accor-conventions/SKILL.md` for branch and quality rules.
