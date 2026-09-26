# Output format — tables and detail blocks

Extends `accor-triage` SKILL.md §5; it owns the sorting and the application
rules, this file owns only **how the synthesis renders**. Load it when writing
the output. Use English verdicts by default: `Request` = must-do request,
`Patch` = patch awaiting approval, `Autofix` = inert micro-fix already applied,
`Rejected` = rejected with a reason, `Stale` = obsolete, and `Question` = needs
an answer. When the current user explicitly asks for French, translate labels
and prose while keeping the same sorting and meanings.

The output is **one table per PR**, one thread per row, plus the detail blocks
below. No diff and no paragraph inside a cell: the table carries the sort, the
blocks carry the content.

## §1 Recap (only with ≥ 2 PRs)

| PR | Short title | Branch | Requests | Patches | Autofixes | Rejected | Other |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #129 | settings api | `feat/DA-179-settings-api` | 1 | 1 | — | — | — |
| #132 | pages 403/404 | `feat/…-error-screen-shell` | — | — | — | — | approved |

Zero threads or an approved PR: one row here, no dedicated section.

## §2 One table per PR

Each PR opens on a level-2 heading — number then real PR title:

    ## #130 — feat(menu-compliance): DA-179 — referential settings tab

| Ref | Verdict | Location | Remark | Action |
| --- | --- | --- | --- | --- |
| 130.1 | Request | `entities/settings/api/index.ts:91` | [BLOCKING, Corentin] rollback restores the entire cache snapshot | Confirmed — target rollback to the edited cell → 130.1 |
| 130.2 | Patch | `widgets/settings-panel/ui/ThresholdCard.tsx:21` | [SUGGESTION, Corentin] `draft` persists across workspace changes | Confirmed — patch ready → 130.2 |
| 130.3 | Rejected | `widgets/…/CategoryList.tsx:44` | [NIT, Corentin] extract a subcomponent | 30 lines, one caller — proposed reply → 130.3 |

Column rules, in order:

- **Ref**: `<pr>.<index>`, index in table order. This is the key the user quotes
  to approve ("ok 130.2") — never reuse or renumber it between turns.
- **Verdict**: one exact word from the contract order
  (`Request`, `Patch`, `Autofix`, `Rejected`, `Stale`, `Question`); sort rows in
  that order.
- **Location**: `path:line` in backticks, stripped from the app prefix
  (`apps/<app>/src/`, `apps/api/src/`); elide the middle with `…/` beyond three
  segments. `isOutdated` thread: suffix ` (outdated)`.
- **Remark**: `[tag, author]` kept verbatim, then the alleged fact in one
  sentence. Never a full quote of the comment.
- **Action**: the verification verdict (`Confirmed`, `Confirmed, lower severity`,
  `False`, `Already fixed in <sha>`) then the next step, in one sentence. Point to
  a detail block with `→ <réf>` when one exists.

A cell stays on one short line: aim ≤ 80 characters, never a line break or a
bullet inside. Overflow descends into a detail block.

## §3 Detail blocks

Below each table, one block per row that needs more than a cell — in réf order.
A block carries one of: the verification reasoning when not obvious, the ready
diff, the proposed reply for a Rejected remark, the nuance that corrects the reviewer.

Each block opens on a **level-3 heading**, never a line of text or a code block:
the réf, then the subject in three to six words — the scroll anchor the user
quotes. A `---` separator between consecutive blocks.

    ### 130.2 — ThresholdCard: draft persists across workspace switch

Expected rendering of a full block (blockquote prose, then the diff):

> `draft` survives between `commit()` and `onSettled`, so `value = draft ??
> thresholdPercent` displays workspace A's value on workspace B's card.
>
> ```diff
> -import { useState } from 'react'
> +import { useEffect, useState } from 'react'
> @@
>      const [draft, setDraft] = useState<number | null>(null)
> +    useEffect(() => setDraft(null), [workspace.workspaceId])
> ```

The Action column points here with `→ 130.2`.

Normally no block for an `Autofix` or `Stale` row — the table suffices. A
`Request` row gets one as soon as the fix needs a code sketch or an arbitration.
A finding made while verifying but absent from the review goes inside the block
of the row it relates to, marked "hors remarque"; it never opens its own row.

## §4 Closing

After the last table, two to four sentences: the count per verdict across all
PRs, what actually touched the working tree, what is blocked by the current
branch, and the follow-up question (which patches to apply, which branch to
switch to).
