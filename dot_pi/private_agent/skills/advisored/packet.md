# Packets

Extends Lifecycle in `SKILL.md`: what `send` records and what you write. The script owns the header and the recorded sections; the file you pass with `--body` is appended under "Written by the implementer". Write it in this order and omit only empty sections.

## Recorded by `send`

Header (`checkpoint`, `round`, `fingerprint`), then the request file, the ledger file, the advisor's previous reply, the per-file diff of every changed path in the scope (untracked files as additions), and every `run-check` evidence file recorded since the previous accepted round, each with its SHA-256. Do not paste any of these again: a repeated diff or a transcribed output only lengthens the packet.

## Body template

```markdown
## Since last round
<decisions taken, routes abandoned and why, deviations from the agreed route>

## Excerpts
<unchanged source the advisor needs to judge the diff, with paths and line ranges>

## Items
<every unresolved ledger row verbatim with your response, a rebuttal beside the finding text it answers>

## Ask
<the decision you need: route, closure of named IDs, or final approval>
```

## Per checkpoint

- `PLAN`: excerpts of the code the route touches, the simplest route and its strongest alternative, the assumptions that could reverse the choice. Ask for the done criteria (`D`), the route verdict and the first decisive check.
- `DECISION`: the deviation, or the expensive, irreversible or repeatedly failing step, with the checks recorded so far. Ask whether to change route.
- `BATCH`: closure of a coherent set of required items, each pointing at the recorded check that proves it. Ask for their closure.
- `FINAL`: every `D` with the recorded check that proves it, every required `A` and `C` disposition, remaining limitations, human deferrals verbatim. Ask for a review of the original request as well as of the fixes.

## Rules

- The advisor has no tools and no memory outside the packet: a path, a claim or a checklist gives it nothing. Record checks with `run-check` and point at them by file name.
- A check recorded on another fingerprint than the packet's proves nothing about the tree under review; rerun it after the last edit.
- Keep excerpts focused: review quality drops as the packet grows, and the diff is already there.
- A rebuttal goes next to the finding it answers, with the counterevidence. Effort spent is not counterevidence.
- Never put a credential value in the body: the recorded diff omits secret-looking paths, your text has no such guard.
