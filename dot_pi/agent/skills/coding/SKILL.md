---
name: coding
description: >-
    Language-agnostic coding judgment that MUST be loaded whenever writing,
    modifying, or reviewing code in ANY language. Covers judgment no tool
    can make: abstraction levels, naming by domain, DRY vs AHA, SOLID,
    purity, error design, test quality (falsifiable, non-tautological
    tests) - plus baseline mechanical caps to enforce even when no linter
    does.
---

# Coding Rules - Mandatory, Language-Agnostic

Apply to ALL code written or modified, in every language. A linter, when the project has one, catches mechanical violations - but the caps below are baseline requirements that apply regardless: when no linter enforces them, YOU enforce them. A cap violation is fixed by redesign, never by silencing or ignoring the rule.

## Mechanical Caps (Baseline)

These apply in every project, linter or not:

- Max nesting depth: 2
- Max function length: 50 lines (ceiling, not target)
- Max file length: 250 lines
- Max cyclomatic complexity: 15
- Max imports per file: 20
- No generic names (`data`, `temp`, `utils`); booleans get question-prefixes (`isActive`, `canRetry`)
- No magic numbers/strings; no boolean parameters

A cap being hit means a design question must be answered - these numbers are tripwires, not targets.

Sub-files, load on demand:

- [architecture.md](architecture.md) - project-level structure rules (deep vs shallow modules, god objects, typed structures, dispatch tables, invariants & ownership, cross-cutting registries, decay signals). Load when designing or modifying structure across files, not just functions.
- [ops-discipline.md](ops-discipline.md) - operational discipline: context economy when exploring code, and never using routing/scope rules as an excuse to skip a worthwhile change. Load when exploring an unfamiliar codebase, or when tempted to drop a change as "out of scope".
- [testing.md](testing.md) - test quality in depth: the falsifiability litmus, tautology patterns and fixes, behavior-over-implementation, fakes vs mocks, determinism, coverage. Load when writing or modifying tests, or when a test smells like a mirror of the code.

## Assumptions, Simplicity, and Scope

Before coding, surface material assumptions and tradeoffs; never silently choose between interpretations that would produce meaningfully different behavior.

Implement the minimum requested behavior. Add no speculative feature, abstraction, configurability, or handling for impossible states. Prefer a direct single-use implementation until reuse is demonstrated.

Make surgical changes: every changed line must trace to the request. Do not refactor, reformat, or clean up unrelated existing code; remove only the imports, variables, functions, and branches that your change makes obsolete.

## Early Returns (Guard Clauses)

Handle invalid/edge cases FIRST and return immediately; never wrap the function body in an `if`. Errors first, happy path last at natural indentation. Flattening techniques (nesting must stay ≤ 2 - see Mechanical Caps): early returns, extract inner blocks into named functions, invert conditions, `continue`/`break` to skip early, pipeline operations (map/filter/reduce) instead of nested loops.

## Small, Focused Functions: Single Level of Abstraction

A function either orchestrates (calls other functions) or implements (does one small piece of work) - never both. If "and" is needed to describe it, split it. Aim for ~20 lines; the 50-line cap is a ceiling, not a target - the real signal is mixed concerns or abstraction levels, which no line count catches.

## Meaningful Naming (Domain Language)

Mechanical naming bans are listed in Mechanical Caps; judge the rest:

- Describe WHAT it holds, not the type: `activeUsers` not `userList`, `retryDelayMs` not `num`.
- Speak the domain: if the business calls it a "claim", the code says `claim`, not `request`.
- Verbs for actions (`fetchUser`, `calculateTax`); predicates return booleans (`isValid`, `canAfford`); name the intent, not the mechanics (`ensureAuthenticated`, not `checkAndMaybeRedirect`).
- No non-standard abbreviations (`cfg`, `ctx`, `mgr`, `svc`) - full words unless universally standard (`URL`, `HTTP`, `ID`). Single letters only in trivial lambdas (`items.map(x => x.id)`).

## Immutability by Default

Do not mutate inputs or shared state - create new values. Prefer pure transformations (`map`, `filter`, spread/copy) over in-place mutation; mutable variables only when accumulation or reassignment is genuinely needed. Mutation for performance stays local to the function scope - never mutate something the caller owns.

## Pure Functions First

Separate computation from side effects: compute the result, then apply it - never interleave IO mid-calculation. Side-effectful operations (DB, network, file, logging) live at the edges, never in utility functions.

## Simplify Conditionals

- **Consolidate related guards when they state one precondition:** three stacked `if (!user...) return` lines that tell one story become `if (!user?.email || !user.isVerified) return`.
- **Lookup tables over long if/else or switch chains:** at ~10 branches a chain is a registry expressed badly - `handlers[status]`, throw on unknown key. Extension-point angle: see *Dispatch Tables, Not Switch Chains* in [architecture.md](architecture.md).

## No Dead Code

Delete commented-out code (git remembers) and logically unreachable branches. Unused vars/imports are caught by a linter when one exists; the two above are on you.

## Fail Fast, Fail Loud

Catch errors as close to their source as possible. Validate inputs at function entry - invalid data must not travel deep before exploding. Error messages include: what was expected, what was received, what the caller should do. Never signal errors with ambiguous values (`null`, `-1`, `false`) when the language has exceptions or Result types.

## DRY: One Source of Truth per Piece of Knowledge

Every piece of knowledge - constant, validation rule, business calculation, type shape - has exactly ONE authoritative home.

- **Rule of three.** Two occurrences are a watch-flag; the THIRD must be extracted to a named constant, function, or module. Don't extract on first sight - the shape isn't known yet.
- **Knowledge, not character-similarity (AHA).** Look-alike snippets that change for different reasons are NOT duplication - keep them apart. A wrong abstraction costs more than the duplication it removed.
- **Across boundaries too.** A value needed in two files or languages (a color, an enum, a route) lives in one place; the other side imports/reads it - never re-hardcoded "for convenience".
- **Grep before writing a helper** - reuse beats rewrite. And when fixing a bug, search for the same mistake elsewhere: duplicated knowledge means duplicated bugs.

## SOLID at the Module/File Level

*Single Level of Abstraction* is SRP for functions; this is SRP for files, plus the rest of SOLID. House positions:

- **S** - One primary export per file, file named after it (`createInvoice.ts` exports `createInvoice`). Split when concerns mix or "and" is needed to describe the file - don't wait for the file-size cap.
- **O** - Extend by adding code (a dispatch-table entry, a module satisfying an interface), not by editing central code on every new case (see *Dispatch Tables, Not Switch Chains* in [architecture.md](architecture.md)).
- **L** - An implementation honors the contract of what it replaces - no surprise `throw`/`null`/narrowed behavior a caller can't see. If it can't fulfill the interface, it needs a different interface.
- **I** - Depend on the narrow surface actually used: pass `{ name }`, not the whole `User`.
- **D** - Depend on abstractions, not details: high-level policy never imports low-level detail (DB/HTTP/FS) directly. See *Deep Modules Over Shallow* in [architecture.md](architecture.md) - this is what makes code testable.

## Test Quality: Every Test Must Be Falsifiable

Tests obey every rule above, but answer to a stricter question: **can a production bug make it fail?** Name the bug a test catches before writing it. No answer means the test is a mirror of the implementation, not a check on it.

**Mirrors (tautological tests) are forbidden** - assertions true by construction:
- Expected values re-derived from the code under test (`expect(add(a, b)).toBe(a + b)`)
- Mock echoes: a stub returns X, a pass-through forwards it, the test "verifies" X
- Asserts too weak to fail meaningfully - they would pass on the broken behavior too
- Snapshots frozen from current - possibly buggy - output

- **Contract, not implementation:** inputs -> observable outputs/effects at the public seam; never private state or call order. Tests that break only on behavior-preserving refactors are miswritten - rewrite them.
- **Expected values come from outside the code:** literals, hand computation, reviewed fixtures - never the function under test or a copy of its logic.
- **Mock only real boundaries** (network, clock, filesystem, randomness); prefer fakes over interactions, and assert interactions only when the call itself is the contract.
- **One behavior per test, named as the requirement** (`refuses expired claim`, not `testUser`).
- **Deterministic:** no sleeps, ordering assumptions, unseeded randomness, live network. A flaky test is broken - fix the cause, never retry around it.
- **Coverage is a measurement, not a goal:** no assert-less or degenerate tests to move the number.

When in doubt a new test can fail, run the mutate-to-kill check: temporarily break the code, watch the test go red, restore. Patterns and worked examples: [testing.md](testing.md)
