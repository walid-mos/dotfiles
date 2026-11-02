---
name: advisored
description: Run a task under a read-only advisor model (a non-Anthropic model by default when you run in Claude Code, Claude Code Opus otherwise, any Pi model with --model) that challenges the route before implementation, fixes done criteria, tracks findings in a ledger, judges recorded diffs and recorded checks instead of your claims, and must approve the delivered tree. Use when the user invokes /advisored, asks for a second model to supervise or review a task, or wants an independent final approval.
argument-hint: "[--model provider/model[:thinking]] <task>"
disable-model-invocation: true
---

# Advisored

One advisor per task. You implement. The advisor reads what `send` records (request, ledger, its previous reply, the diff of the fingerprinted tree, the checks you ran through `run-check`) plus the body you write, challenges the route, and closes findings on evidence. Between rounds it keeps nothing but those recorded parts. Your own checklist, a finished plan or a green process is never approval. Approval is one thing only: `verify` exiting 0, which means a `READY` reply to a `FINAL` packet whose fingerprint still matches the tree you deliver.

`scripts/advisor.ts` does the deterministic work: task directory, contract freeze, fingerprint, diff and evidence capture, launch, reply validation, delivery check. Read [transport.md](transport.md) before the first script call. Read [packet.md](packet.md) before writing a packet body. [advisor.md](advisor.md) is the advisor's system prompt, frozen per task by `init`, not instructions to you.

## Start

Parse the leading `--model <provider/model[:thinking]>` only. Everything after it is the task, kept verbatim. Pass `--model` through to `init` when given. Without it, `init` picks the advisor family itself: a non-Anthropic model when you run in Claude Code, Claude Code Opus otherwise. When you run on an Anthropic model inside Pi, pass `--model` with another family yourself: same-family review shares blind spots. A missing value, a duplicate option or an unresolvable model stops the run: never fall back to another model.

The task text follows these instructions (Claude Code appends it as `ARGUMENTS:`, Pi as a trailing request). When the conversation already holds a clear request, use it.

## Lifecycle

Each step ends on its completion criterion.

1. **Open the task.** Write the original request and its constraints to a file, run `init`, and add an `advisor-review` item to your task checklist naming the state directory and this skill's path. Done when `init` printed the state directory and the checklist item exists.
2. **PLAN round.** Before any implementation, send a `PLAN` packet. Answer `REVISE` or `NEEDS_EVIDENCE` with another `PLAN` packet carrying what was asked. Done when the reply is `PROCEED` and the ledger holds every `D`, `A` and `C` item it issued.
3. **Implement.** Follow the agreed route. Run every check the advisor or the request names through `run-check`, never by hand: only recorded checks count as evidence. Send a `DECISION` packet before a material deviation, an expensive or irreversible step, or after repeating a failed approach. Done when every `D` criterion has a recorded check you observed yourself.
4. **Resolve items.** For each required `A` or `C` item: implement and record the evidence, or rebut it in the next packet. Group closures in a `BATCH` packet when several items are ready. Done when every required item is `evidence supplied`, `rebutted` or `blocked-by-constraint` in the ledger.
5. **FINAL round.** Send a `FINAL` packet after the last edit, so the recorded checks carry the packet's fingerprint. Answer `REVISE` with the fixes and a new `FINAL` packet, `NEEDS_EVIDENCE` with recorded checks. Done when the reply is `READY`.
6. **Deliver.** Run `verify`. Exit 1 means the tree changed after `READY`: return to step 5. Tick the `advisor-review` checklist item, then the task item. Report as described below.

Consult at these checkpoints, not after every edit. Wait for the reply before taking a step that depends on it, then state how the next action follows the advice. Prefer a better route over defending sunk work. After each round, note the round, verdict and count of open required items in your checklist item. After a compaction, reread this skill, `state.json` and the ledger before continuing. Missing state is lost continuity: report it instead of inferring prior approval.

## Ledger discipline

`ledger.md`, seeded by `init`, is the single record of advisor items and is recorded into every packet. Copy every `D`, `A` and `C` item from each reply verbatim with its origin round. Update rows in place. Never rewrite the ledger as a summary and never drop a row. The advisor owns classification and closure: you may mark `proposed`, `implemented`, `evidence supplied`, `rebutted` or `blocked-by-constraint`, nothing else. Reconcile after every reply. An ID the advisor omitted stays open. A changed criterion is a new row that references the old one. Optional items need one recorded disposition and never block delivery. Record abandoned routes under "Routes tried" so the advisor keeps seeing them.

When advice conflicts with a user constraint, mark `blocked-by-constraint`, quote the constraint, and ask the advisor for a permitted alternative or a withdrawal. Advice grants no permission.

## Disagreement

One rebuttal round per item. If the advisor holds a required item after your counterevidence, stop arguing: escalate through the harness's question tool (`ask_user_question` in Pi, `AskUserQuestion` in Claude Code) with both routes and their consequences, continue the work outside that item's scope, and record the answer verbatim beside the item. A deferral is not advisor acceptance, and the report names it. Two `REVISE` verdicts on `FINAL` packets also escalate instead of a third attempt.

## Report

Lead with the implementation result. Then give the `verify` output (round, fingerprint, approval), the recorded checks with their outcomes, open optional items, human deferrals, and the state directory path. State that the advisor judged recorded material and ran nothing itself. If `verify` did not exit 0, write `Not advisor-approved` and name the open item or the failed operation.
