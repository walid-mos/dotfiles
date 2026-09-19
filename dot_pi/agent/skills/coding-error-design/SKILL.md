---
name: coding-error-design
description: >-
    Failure contracts: exceptions over error codes, try-catch-first as an
    explicit contract, null discipline, special cases that are not failures.
    Load WHEN writing try/catch, throwing or rethrowing, deciding how a
    function fails, returning error codes or null, wrapping a library's
    exception, handling validation edge cases, or declaring a field, schema,
    or type contract nullable. Do NOT load for plain feature logic with no
    error paths.
---

# Error Design - Failure Contracts

## Exceptions Over Error Codes

Returning error codes welds two concerns into one structure: the caller must check immediately at every call site (or swallow silently), and a shared error enum couples half the codebase to one file. The algorithm drowns in checks.

With exceptions, the happy path reads as a list of steps and the failures live at the edge:

```js
// Before: the algorithm is invisible under its error branches
if (!account) return { code: "NO_ACCOUNT" };
if (!funds)   return { code: "NO_FUNDS" };
if (!limit)   return { code: "OVER_LIMIT" };
// ...each new step nests deeper

// After: four steps, and each concern lives apart
verify(account);
resolve(channel);
moderate(content);
broadcast(members);
```

## Write the Try-Catch-First

When a function is EXPECTED to throw, define its failure contract before writing the logic: name the failure behavior the contract carries (`withdraw` throws `TransactionFailed`), build the try/catch frame, translate whatever is thrown inside into YOUR domain error, and only then fill the happy path. Everything added later inside the `try` stays inside the contract - callers keep handling exactly the failures the contract names, nothing new leaks out.

## Exceptions Are for What Breaks, Never for Control Flow

A normal branch that happens to be implemented as a throw - "catch as if" - hides planned behavior inside error handling, taxes every caller with a try/catch for a path that runs daily, and confuses failure with outcome.

```js
// Before: catch is doing an if's job - region without a rule is a NORMAL case
try {
  const rate = lookupRule(order.region);
  tax = subtotal * rate;
} catch {
  tax = subtotal * STANDARD_RATE;
}

// After: the special case is a value, like any other rule
const rate = lookupRule(order.region); // unknown region -> defaultRule(), never throws
tax = subtotal * rate;
// the catch block disappears; one path, no try
```

Fix pattern: make the missing case an honest member of the returned vocabulary (`defaultRule()`, empty cart, standard rate) and the whole error layer vanishes.

## The Null Problem: Do Not Return Null

A returned null forces every caller into a guard pyramid - each level checking the level below, one missed check a NPE far from the cause. The fix is fewer nulls at the source, not more guards:

- Absence with a do-nothing value returns that value: no orders -> `[]` (iterating it does nothing, which is exactly what "no orders" means); no discount -> `0`.
- Absence that is PART of the caller's logic may be null: a signed-out user is legitimately `null` - the callers check it as business logic, not as defense.
- When something has actually GONE WRONG and null would fail silently, throw instead - a thrown error names the cause and points to where the invariant broke.

**Null wears types too.** A `| null` field on a returned record is returned-null at the type level: every consumer inherits the guard. Genuine business absence may be nullable; data the producing source always carries must be required — and a fallback repeated at every call site (`name ?? code`, again and again) is the guard pyramid rewritten. Fix the contract, not the call sites.

Flatten pyramids by removing what is guarded, never by adding another check.

## Failures Speak the Caller's Language

A thrown name states the domain failure (`TransactionFailed`, `PaymentDeclined`) with the cause attached; catching code reads the contract without opening the implementation.

## Cross-References (authoritative elsewhere - never restate here)

- Fail-fast placement, error message content (what was expected / received / to do), never signaling broken results with ambiguous values: `~/.pi/agent/skills/coding/SKILL.md` (Fail Fast section).
- A function's failure contract, when the user authorized test work (red first): `~/.pi/agent/skills/coding/testing.md` and `~/.pi/agent/skills/coding-tdd/SKILL.md` (Three Laws, try-catch-first comes with its failing test).
- Library exception types get translated at wrappers, never caught directly in feature code: `~/.pi/agent/skills/coding-boundaries/SKILL.md`.
