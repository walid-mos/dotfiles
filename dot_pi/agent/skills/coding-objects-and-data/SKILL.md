---
name: coding-objects-and-data
description: >-
    Data/object modeling: expose behavior instead of structure, the
    objects-vs-data-structures bet, Law of Demeter (tell, don't ask), and
    hybrids to refuse - DTOs and ActiveRecords stay data-only, business
    logic moves to its object. Load WHEN modeling or reviewing classes,
    types, entities, or data shapes, deciding where behavior lives, adding
    getters/setters, writing long property-access chains, or touching
    ORM/entity/DTO models. Do NOT load when editing UI component markup,
    styles, or a function body with no modeling decision involved.
---

# Objects and Data - Expose Behavior, Not Structure

## No Reflexive Accessors

Private fields re-exposed by getters/setters per field are public fields wearing a suit - every caller can see the shape, so the shape can never change. Design around what callers DO with the data:

- Expose behavior/policy queries (`percentFuelRemaining`), not storage (`gallons`, `diesel`): the representation becomes free to change (cartesian `x,y` to polar `r,theta`) while callers stay intact.
- Abstraction lets the interface ENFORCE invariants: coordinates readable independently but settable only as one atomic pair - impossible with public accessors.
- Blind accessor generation on a new class is the smell: list the operations first, then decide what state they need.

## Every Class Is a Bet: Objects vs Data Structures

The two designs fail in opposite directions:

- **Procedural** (dumb data + functions that operate on it): adding an OPERATION (`perimeter(shapes)`) touches one function; adding a TYPE (new shape) edits every function.
- **Object-oriented** (behavior lives with data): adding a TYPE touches nothing else; adding an OPERATION means every class grows a method.

Decide by the axis of change you actually expect, not by fashion: enums/config-like shapes feeding many external operations stay data; domain concepts that keep multiplying variants become objects.

## Law of Demeter: Talk to Friends, Not Strangers

A method may call only: itself, objects it created, its arguments, and its fields - never what those calls RETURN. `context.options.scratchDir.absolutePath` makes one line carry three links of structural knowledge (and every refactor of the internals breaks every caller).

- The fix is NOT collapsing the chain ("the name would just encode the path" - knowledge moves, stays rigid). The fix is TELLING the object what you need: `context.createScratchFile()`.
- Exemption: data structures may honestly expose internals - a chain over plain DTO fields is not a Demeter violation. The moment those getters hide behavior, the chain IS a violation.

```js
// Before: asking three strangers about their internals
const path = context.options.scratchDir.absolutePath;

// After: telling the one object what you need
const path = context.createScratchFile();
```

## Pick a Side - Hybrids Lose Both

- **Object:** hides data, exposes behavior.
- **Data structure:** exposes data, no behavior (DTO moving rows/shapes between layers; ActiveRecord with only its navigational methods `save`/`delete`).
- **Hybrid:** getters leak the shape AND business logic sits inside - adding functions is hard, adding types is hard. When "discount calculation" lives on an exposed-fields class, move it to its own object (`PricingPolicy`); the record stays a pure mapper.

## Cross-References (authoritative elsewhere - never restate here)

- Deep vs shallow modules, typed structures, ownership invariants: `~/.pi/agent/skills/coding/architecture.md`.
- Immutability by default, pure functions first: `~/.pi/agent/skills/coding/SKILL.md`.
- Where a boundary object gets its seams for tests: `~/.pi/agent/skills/coding-boundaries/SKILL.md`.
