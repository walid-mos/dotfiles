# Test Quality - In Depth

Extends **Test Quality: Every Test Must Be Falsifiable** in `SKILL.md`; the core rules live there and are not restated - this file adds the worked examples, the mechanics, and the judgment calls. Tests are the only artifacts whose product is confidence: a suite full of mirrors is worse than no suite - it shows green while the code rots.

## Prove the Test Can Fail

- **Mutate-to-kill mechanics:** temporarily break the code the test exercises - invert a condition, off-by-one a loop bound, swap an operator - run the suite, confirm the test goes red, then restore. Never leave the mutation behind. Anything heavily mocked must pass this check before being trusted.
- **A bug fix ships with a test that FAILED before the fix** and passes after. A test written after the fix already passed confirms what the fix already proved - if it could have failed, it should have.

## Tautology Patterns, Dissected

### 1. Expected value derived from the implementation

```ts
// Tautological: re-implements the logic under test
const expected = input.split("-").reverse().join("/").toLowerCase();
expect(formatPath(input)).toBe(expected);
```

```ts
// Falsifiable: an independent literal the author states by hand
expect(formatPath("Docs/Getting Started")).toBe("docs/getting-started.md");
```

Every test asserts something the author knows *without* the program: literals, hand-computed values, reviewed fixtures. If computing the expectation needs the same algorithm as the code, the test verifies only that two copies agree - and a shared copy-pasted bug agrees too.

### 2. Mock echoes

```ts
// The stub returns the user, the forwarder forwards it, the test "verifies" arrival
userRepo.find.mockResolvedValue(user);
expect(await getProfile(id)).toEqual(user);
```

An unkillable pass-through test is also a verdict on the code: a function that merely forwards is a shallow module - see the deletion test in [architecture.md](architecture.md). Fix the module instead, or assert a real transform, decision, or lookup key. When real behavior exists, drop the mock for a lightweight fake and assert outcomes.

### 3. Asserts too weak to fail

- `expect(() => f(x)).not.toThrow()` as the only check - crashes caught, wrong values sail through
- `expect(result).toBeDefined()` / truthy on values that were never in doubt
- Round-trip checks: expecting back exactly what was fed in
- Catch-then-pass blocks: `catch { /* it's fine */ }`
- First-run snapshots committed blind - they regurgitate whatever the code does today, bug included

### 4. Snapshots as golden truth

Snapshots are change-detectors for stable, reviewed artifacts (generated schema, serialization output) - not expectations for logic whose correct value a reviewer can state. On mismatch: examine the diff and decide consciously - "update snapshot" is a reflex, not a review. A baseline committed from buggy behavior cements the bug as expected output.

## Behavior Over Implementation

Additions to the SKILL.md rule:

- **Refactor-survivability instances:** renaming an internal, inlining a helper, reordering internal calls - none may turn a test red.
- Complex private logic deserves its own *module*, not a test backdoor (architecture.md - the interface is the test surface).
- Prefer edge cases over happy paths: empty and single-element inputs, boundaries, failure branches. Straight-line happy paths rarely hide bugs.

## Fakes vs Mocks

A fake is behavior; a mock is a conversation. Prefer fakes (in-memory store, scripted clock) - they verify outcomes, and a conversation can be correct while the outcome is wrong.

Never mock: the unit under test, internal collaborators that are not at a boundary, language stdlib. Observe interactions only through a boundary you own - spy on the injected adapter that sends the email, publishes the event, refuses the payment - never by reaching into internals.

## Determinism

- Inject clock and randomness; rebuild fixtures per test; assume nothing about execution order or parallelism.
- Fix a flaky test's cause - never retry-until-green, loosen tolerance thresholds, or mark `skip`.
- No `sleep`: await the completion signals the design exposes (promise, callback, queue drain). If none exist, the design hides its synchronization - surface that, do not paper over it.

## Structure, Naming, Coverage

- Do not bypass the assertion engine: no `expect(a || b).toBe(true)`, no hand-rolled boolean comparison - both delete the expected-vs-received diff that makes failures diagnosable.
- Tests obey the SKILL.md caps; share setup with small helpers, not inheritance or god fixtures. Each test states the data it needs.
- Coverage measures reached lines, not verified behavior - every line is coverable with zero falsifiability. Use it to locate untested areas. 

## What Needs No Test

- Language and framework semantics (that `map` exists, that JSON serializes).
- Generated artifacts: test the generator, not its output.
- Trivial declarative data (type maps, config tables) already checked by schema or compiler - unless the data encodes a decision worth stating, then one test states it.
