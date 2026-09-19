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

## Tool-choice audit

Measures the reflex the guard exists to break: bash called for work `read`/`ls`/`grep`/`find` own, and
whether a refusal changes anything. It reads the guard's own policy, so it counts exactly what the
guard would refuse — plus the half the guard never sees (piped, redirected, summary and `/tmp` forms).

```bash
node audits/tool-choice-audit.ts            # every session log on disk
node audits/tool-choice-audit.ts --days 7   # only the last week
```

| Section | Question it answers |
| --- | --- |
| 2. attempts | How much bash carries a dedicated tool's work, and how much of it the rule covers |
| 3. escapes | Why the covered forms still ran (pipes, redirects, grep summaries, `/tmp` logs) |
| 4. look-alikes | bash file readers the rule never names (`head`, `sed`, `jq`, ...) |
| 5. recovery | What the model calls first after a refusal, and how far the dedicated tool was |
| 6. repetition | Refusals per session and per turn |
| 7. orient reflex | How often a turn opens with bash before reaching a dedicated tool |
| 8-9. models, days | Whether the share is a model's quirk or a day's, or the harness every day |
| 10-11. refusals, host | The literal refusals, and macOS commands run through bash instead of `host` |

### How to read it

- **The wrong-tool share is the number to move**, not the refusal count: work the guard exempts
  (a count, a mutation, a throwaway log) is still the reflex, and tightening the guard raises refusals
  without lowering attempts. Read section 2's first line and section 7.
- **Verdicts are the guard's, not a copy**: `extensions/tool-guard/` classifies both the refused work
  and the exempt forms it fell under (`exemptionReason`), `tool-choice-parse.ts` only counts, so the
  escape vocabulary cannot drift from the rule.
- **Sections are one runnable script** over `~/.pi/agent/sessions/**/*.jsonl`; the parse/scan split
  mirrors `tool-call-audit.ts` / `scan.ts`.

### Baselines

- `tool-choice-audit-2026-09-19.md` — the baseline: 47% of 28,250 bash calls carried a dedicated
  tool's work, 77% of it in a form the guard allows (97% of those piped), 644 refusals against 13,179
  attempts (one correction per 20.5), 53% of turns opened with bash, and a share that stayed at 44-60%
  every day across ten models — including after `tool-guard` landed on 2026-09-16.

## Handoff pipeline

Audits the `context-budget` handoff pipeline against the `handoff` skill it injects: Pocock
fidelity, per-cycle context loss, and the failure modes visible only in the transcripts.

```bash
ls ~/.pi/agent/handoffs | wc -l                          # handoff corpus
cat ~/.pi/agent/context-budget.json                      # ceiling in force
grep -c '"fromHook":true' ~/.pi/agent/sessions/*/*.jsonl # extension compactions per session
```

- `handoff-pipeline-2026-09-18.md` — the baseline: 105 compactions, 19 duplicate-handoff
  writes (17% of cycles), the numbers behind "160k costs ~4-7x compression per cycle", and a
  measurement of pi's own 46 default compactions (median kept span 173k chars, largest 7.1M —
  a compaction that freed almost nothing, built from a serialization with tool results cut to
  2000 chars).
  The duplicate pair is visible as two `compaction` entries whose `tokensBefore` grows, twenty
  seconds apart, in one session log.
- `handoff-pipeline-2026-09-19.md` — why a handoff ask died with a bare `Operation aborted`:
  the ask waited for a settle that came 36k tokens later, the provider refused the request, and
  pi's overflow recovery compacted with its own summary. Read it before changing when the ask
  goes out, or before trusting a declared `contextWindow`.

## Harness footprint

Measures the prompt payload every session pays before the first message, by
assembling the real system prompt and tool set through the SDK's standard
discovery (context files, skills, extensions). In-memory session: it writes no
session log and makes no model call.

```bash
node audits/harness-footprint.ts            # report
node audits/harness-footprint.ts --rows 25   # longer tool table
node audits/harness-footprint.ts --tool subagent   # where one schema's bytes go
```

| Section | Question it answers |
| --- | --- |
| harness floor | How many tokens a session carries before any message, system prompt vs tool schemas |
| system prompt composition | Which injected block pays for what |
| skills: listing vs bodies | What the always-on skill listing costs against the bodies it defers on demand |
| tool schemas | Which tools are worth their schema |

### How to read the footprint

- **This measures the unscoped floor.** The audit's session is not a UI session, so `tool-scope`
  (which scopes `tui`/`rpc` sessions) does not apply here: the tool rows below are the *upper*
  bound. An interactive session starts roughly 7.9k tokens lighter, minus the loader it adds
  (the deferral list lives in `extensions/tool-scope/policy.ts`).
- **Token counts are chars/4.** Right for prose, conservative for JSON schemas, which are
  denser - the tool totals are if anything under-counted.
- **The floor is a floor.** It excludes per-turn injections (the subagent advertisement),
  message history, and anything an extension appends later in the turn.
- **Skills are lazy, and the audit proves it**: the listing is what the model always sees,
  the bodies column is what it would cost if every skill loaded. A large ratio is the
  design working, not a problem to fix.
- **The listing entry is not the description.** Each entry also carries the name, the
  absolute location, and the XML scaffolding - roughly a third of the listing.
- **Tool schemas dominate.** A single fat schema (the subagent tool was 4.1k tokens) can
  outweigh the whole system prompt. `--tool NAME` splits one schema into its description
  and its parameters, ranked, which is what tells you whether trimming prose is worth it
  or the parameter surface is the real cost. `--exclude-tools` scopes whole schemas out
  per invocation; `pi.setActiveTools()` (see docs/extensions.md, "Dynamic Tool Loading")
  scopes them per project or defers them until asked for.

### Baselines

- `harness-footprint-2026-09-18.md` - the run that sized the harness at ~15.9k tokens before
  the first message (10.7k of it tool schemas), with 20 skills listing at 2.8k against
  29.3k of deferred bodies.

## Jev grep-filter eval

Replays past `grep` calls through Jev (TypeSafe System One) and measures whether its per-file
judgments predict the files the session went on to use. One Noul per candidate file; ground
truth is the file being referenced in the next 50 tool calls (`read`/`edit`/`write`/shell).

```bash
node audits/jev-eval.ts extract [--days 30] [--limit 200] [--per-session 25]
node audits/jev-eval.ts score     # resumable: already-scored ids are skipped
node audits/jev-eval.ts report    # writes audits/jev-eval-<YYYY-MM-DD>.html
```

Data lives outside the repo, in `~/.pi/agent/jev/{samples,scored}.jsonl`; the report is
self-contained and reads no network. The prediction wording and the pinned model live in
`audits/jev-eval/score.ts` and `extensions/jev/client.ts` — changing either invalidates the
calibration numbers, so both belong in the same commit as the report that quotes them.
`TYPESAFE_API_KEY` comes from the shell environment; `score` refuses to start without it.
