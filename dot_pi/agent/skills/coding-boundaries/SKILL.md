---
name: coding-boundaries
description: >-
    Dependency-boundary design: wrap third-party libraries, SDKs, and
    external APIs behind interfaces the application owns, adapters that
    translate at the border, owned exception types. Load WHEN adding a new
    dependency, integrating an SDK or external API, catching a library's
    exceptions, writing an adapter or provider wrapper, upgrading a
    dependency (especially a major), or swapping a provider. Do NOT load
    for internal code with no third-party interaction.
---

# Boundaries - Own Your Dependencies

## You Control the Surface, Not the Library

Every direct import of a third-party SDK inside feature code is a lease on your codebase: you cannot stop the library from changing, but you decide how much code the change touches. One search for the import shows the reach; the reach is the damage radius of the next breaking change.

## Wrap at the Boundary

Expose one small class or module that speaks the verbs YOUR application needs - `charge(order)`, `fetchOrders(customer)` - and hide the library inside it. Feature code calls a vocabulary you own, never the SDK's.

```ts
// Before: the SDK reaches everywhere (and 14 other files do the same)
import { StripeClient, StripeCardError } from "stripe-sdk";
const res = await stripeClient.charges.create({ amountInCents, token });

// After: one wrapper; feature code sees only your words
interface PaymentGateway {
  charge(order: Order): Receipt;
}

class StripeGateway implements PaymentGateway {
  async charge(order: Order): Promise<Receipt> {
    // cents, tokens, Stripe types - all stay inside this class
    const res = await stripeClient.charges.create(this.toStripe(order));
    return this.toReceipt(res);
  }
}
```

## Exception Types Belong to Your Design

A library's exception types are distinctions the LIBRARY needs, not distinctions your code needs. Catch them inside the wrapper only, and rethrow types you defined (`StorageFailure`, `PaymentDeclined`). Application code never imports a library error type - otherwise a provider swap means editing every catch block.

## Write the Adapter First

When the real provider is not ready, or its shape does not match what your code needs:

1. Define the interface your CALLERS need - its shape comes from your use, not from the provider.
2. Build against it today with a fake (approves every charge). Tests then exercise your logic, not theirs.
3. Translate the mismatch (cents vs dollars, token vs card) inside ONE adapter implementing your interface.

Result: when the provider finally ships, or must be swapped (`S3` to `GCS`), you write a new adapter - every line of already-finished code stays untouched.

## Wrap or Use Directly - the Judgment

Not every import deserves a wrapper; wrapping is boilerplate without a decision point.

Wrap when: swapping or major-version churn is plausible, the failure surface is nontrivial (exceptions, retries, statuses), or the API's vocabulary does not speak your domain.

Use directly when: the library is a pure, stable utility consumed for its output (date math, deep clone) with no IO, no failure mode you translate, nothing you might swap.

## Cross-References (authoritative elsewhere - never restate here)

- Depend on abstractions, deep modules over shallow: `~/.pi/agent/skills/coding/architecture.md` - wrappers are the concrete instance of rule D.
- Owned-exception design and catch-block discipline: `~/.pi/agent/skills/coding-error-design/SKILL.md`.
- Testing the seam with a fake instead of mock-echoes: `~/.pi/agent/skills/coding/testing.md` (Fakes vs Mocks).
