---
name: coding-tdd
description: >-
    TDD, calibrated by pace: strict red-green test-first for core business
    logic and bug reproduction, build-then-lock for prototypes, mechanical
    edits, and glue code. Load WHEN writing, modifying, running, or
    reviewing tests, or when the user explicitly asks for TDD. Do NOT load
    for production edits that touch no test file, for refactors under a
    green suite, for config-only changes, or for UI-only frontend work.
---

# TDD - Calibrated Test-First

## Choose the Pace Before Writing Anything

Ceremony beyond what a change deserves is waste. The pace decides how much test ritual a change gets - pick it explicitly when a task spans several steps, and state it in the plan:

| Pace | Applies when | Ritual |
|---|---|---|
| **Business** | new or changed observable behavior in domain logic: money, permissions, state transitions, contracts, invariants | strict test-first (Three Laws below) |
| **Bug** | a reproducible defect | ONE failing test that names the bug, then the fix; the test stays |
| **Refactor** | behavior-preserving edits | keep the existing suite green; no new tests; narrowest possible run |
| **Default (build, then lock)** | prototypes, spikes, glue code, config, mechanical edits, presentation logic, one-off scripts | build the change directly; lock it with tests only once the shape stabilizes |

Wrong-pace examples are the usual time sinks: a red-green cycle per mechanical edit, a full suite run per iteration, tests for a script that will be deleted tomorrow.

## Business Pace - The Three Laws

1. Write no production code except to pass a failing test.
2. Write only enough of a test to fail - a compile/type error already counts as failing. Then stop.
3. Write only enough production code to pass. Then stop.

Consequence: every production line exists because a test asked for it; the suite is one step ahead. A new idea mid-cycle becomes a new failing test.

```js
// Before: the claim is buried under assembly mechanics
test('rejects an expired card', () => {
  const clock = new FixedClock('2026-01-01');
  const card = new Card('4111...', 12, 2020, 'VISA');
  const validator = new CardValidator(clock, defaultRules());
  const result = validator.validate(card);
  const codes = result.errors.map((e) => e.code);
  expect(codes).toContain('EXPIRED');
});

// After: build the world - run the action - check the result
test('rejects an expired card', () => {
  givenToday('2026-01-01');
  const card = cardExpiring('12/2020');

  const result = validate(card);

  expectRejected(result, 'EXPIRED');
});
// Reads: Given today is 2026-01-01 and a card expiring 12/2020,
// validate the card, expect it rejected as EXPIRED.
```

Structure rules at business pace: state facts in the world part (`givenToday`, `givenCustomer`), never assembly steps; one visible action; only the final claim (`expectRejected`, never `result.errors.map(...)`). Helpers carrying boilerplate serve the whole suite - the claim line never hides inside one.

## Default Pace - Build, Then Lock

- Build directly and iterate cheaply while the shape is unsettled; spike code pays no test tax.
- Lock step (once, not per iteration): the design stabilized, the behavior was accepted, or the code is being reused - then write falsifiable tests around the stable shape.
- One-off scripts and dead experiments: mark them expendable instead of half-testing; no ceremony on throwaway code.
- Writing an unlocked test never excuses a mirror - an uncalibrated test is still a falsifiable one.

## Mechanical Discipline (All Paces)

- Run the NARROWEST scope: the single test case or file touched - never the full suite per cycle. One full run before presenting or committing, not more.
- One narrow run per iteration step; batch small mechanical edits and run once after all of them.
- A change provable by one narrow green run is refactor pace - adding a red-green cycle to it is tempo drift, not rigor.

## Hold Tests to the Production Standard

An unreadable test is a skipped test: when a locked test breaks, it must state what it wanted. Every test file obeys production naming, structure, and dead-code rules.

## Tests Buy Courage (-ilities)

Behavior-locked code is replaceable code: slow implementations get swapped, unreadable code gets cleaned, regressions arrive with names attached. "It works, don't touch it" marks an untested region, never good code.

## Cross-References (authoritative elsewhere - never restate here)

- Falsifiability, tautologies, fakes vs mocks, determinism: `~/.pi/agent/skills/coding/testing.md`.
- Try-catch-first failure contracts are written at business/bug pace: `~/.pi/agent/skills/coding-error-design/SKILL.md`.
- Clean seams (clock, storage, gateway) that make fake worlds cheap: `~/.pi/agent/skills/coding-boundaries/SKILL.md`.
