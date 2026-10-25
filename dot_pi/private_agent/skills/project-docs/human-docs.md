# Human docs

Extends step 3 in `SKILL.md`; the stateless gate is not restated here.

## The set

Write a page only when it answers a question a reader actually has, and give each question one page.

| Page | Answers | Holds |
| --- | --- | --- |
| `README.md` | What is this, how do I start, and how does it work overall? | One or two sentences on what it does and why. A quick start. One big-picture state diagram. The main flow as a short numbered list. Links in the prose wherever a reader needs depth. |
| `docs/architecture.md` | How is the code split, and what happens when I run a command? | The parts, as a flowchart. Each boundary's contract. A sequence diagram per command. A state diagram per lifecycle, with failure states included. A "failure → what is left" table. The guarantees. |
| `docs/configuration.md` | Where do options come from? | Only when the project has configuration: precedence as a flowchart, where files live, and how mistakes are reported. |
| `docs/<area>/<name>.md` | How does this integration behave? | One page per external system or plugin: setup, options (names, not values), and what crosses the boundary. Also the external resource's state machine, a sequence per operation, failure semantics, and each design choice beside the thing it explains. |

Contributor material, such as checks, conventions and how to extend the project, goes in the root AGENTS.md, which people read too. It never gets a docs page of its own as well.

## Writing

- Open each page with one or two sentences that say what it explains.
- Put the diagram first, then the prose that explains it. Give each diagram one idea and about ten nodes at most. Drop a diagram that only repeats a list.
- Use tables for reference, such as options and failure outcomes. Use prose for reasons.
- Put each reason beside the thing it explains. A separate design-choices section is only for choices that span several pages.
- Use one term per concept, and define it in a few words where it first appears.
- Write short sentences that carry one fact each. Apply `unslop`.

## Diagrams

Use Mermaid, which GitHub renders.

- **`stateDiagram-v2` for anything with a lifecycle.**
  - Name failure outcomes as states, such as `state "Failed, VM still runs" as Recorded`.
  - Use a composite state for the big picture, for example the account states with the VM states inside.
  - Use a `note` for a rule that changes what the diagram shows.
- **`sequenceDiagram` with `autonumber` for each command or operation.**
  - `alt` for outcomes, `opt` for conditional steps, `loop` for polling.
  - `Note over A,B` for a check that stops the flow. Spanning both participants keeps the note wide.
- **`flowchart` for structure and for precedence decisions.**

Labels follow three rules:
- Put no colon or semicolon inside a label.
- Write placeholders in capitals, such as `ID`, rather than `<id>`.
- Copy no value from the code. Write "within a time limit" instead.
