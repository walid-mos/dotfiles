# Session audits

Re-runnable measurements of how the agent spends tool calls, so the rules in
`AGENTS.md` (`# Tool calls`) can be checked instead of trusted.

```bash
node audits/tool-call-audit.ts            # every session log on disk
node audits/tool-call-audit.ts --days 7   # only the last week
```

Reads `~/.pi/agent/sessions/**/*.jsonl` (the Pi session logs) and prints four sections:

| Section | Question it answers |
| --- | --- |
| 1. host-level blind waits | How much wall-clock did `sleep`-as-a-wait burn, and how much of it the guard now blocks |
| 2. bash work a dedicated tool owns | How often `cat`/`ls`/`grep`/`rg`/`find` ran instead of `read`/`ls`/`grep`/`find` |
| 3. tool calls holding the turn ≥60s | Which commands block a turn for a minute or more (detach candidates) |
| 4. waiting primitives | How often `bg_wait` and async `subagent` are used at all |

## How to read it

- **Sections 1 and 2 use the guard's own code** (`extensions/tool-guard`), not a copy of the
  rules: the audit cannot drift from what `tool-guard` actually blocks. Total waits include
  sub-threshold sleeps (`< 10s`); "the guard blocks" counts only the ones a call is refused for.
- **Guest-level delays are excluded** on purpose: `sleep` inside a quoted `container exec`,
  a container keep-alive, or a test fixture is legitimate and never counted.
- **Section 3 durations are upper bounds.** Pi records a call's timestamp and its result's
  timestamp; the gap also covers idle time before the result was written, so a hung call that
  was later aborted looks huge. Those are counted separately (`interrupted, so not slow work`)
  and excluded from the list — the marker is the `Command aborted` result pi writes.
- **Section 4 is the point of the whole exercise**: waits that could be a `bg_wait`, an async
  subagent, or a later call instead.

## Baselines

- `tool-call-audit-2026-09-16.md` — the run that motivated the guard: 208 waits ≥5s for 198
  minutes, 2,345 calls whose work a dedicated tool already owned, `bg_wait` used 4 times.
- Later runs belong in the same folder, `tool-call-audit-<YYYY-MM-DD>.md`, so a regression is
  visible as a number, not a feeling.
