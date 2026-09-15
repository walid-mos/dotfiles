---
name: accor-triage
description: >-
    Triage review comments received on MY PRs of accor-hotels/product-data-apps
    ("regarde les retours sur la 130 et la 133", "traite les commentaires de
    review", "qu'est-ce que Corentin a demandé sur la 132"): collect threads via
    gh, verify each remark against the CURRENT code, sort into
    Refusé/Caduc/Autofix/Patch/Demande/Question, produce the recap tables +
    detail blocks. Only inert micro-fixes reach the working tree unprompted;
    patches, replies and thread resolution wait for explicit approval.
---

# accor-triage — sort and act on received review comments

Input: one or more PR numbers (my PRs). Output: one table per PR sorting the
received comments — real requests, patches to validate, autofixed, rejected,
obsolete, questions — with diffs and proposed replies in detail blocks below the
tables. Only inert micro-fixes land in the working tree without asking; the rest
is proposed and waits for an "ok".

`accor-conventions` applies (branches, commits, baseline, zero narrative
comments). Default repo: the one in the cwd; otherwise
`--repo accor-hotels/product-data-apps`.

## 1. Collect

Per PR, one GraphQL call carrying the threads, their resolution state, and the
replies already posted — owner/repo derived as above (substitute `<owner>` /
`<repo>`):

    gh api graphql -f query='
    query($owner:String!,$repo:String!,$pr:Int!){
     repository(owner:$owner,name:$repo){ pullRequest(number:$pr){
      reviewThreads(first:100){ nodes{
       id isResolved isOutdated path line
       comments(first:20){ nodes{ databaseId author{login} body diffHunk createdAt } } } } } } }
    ' -F owner=<owner> -F repo=<repo> -F pr=<n> > threads-<n>.json

Then the PR comments outside code lines and the review bodies:

    gh pr view <n> --json number,title,headRefName,baseRefName,url,comments
    gh api repos/:owner/:repo/pulls/<n>/reviews --jq '.[] | select(.body != "") | {user: .user.login, state, body}'

Discard outright: `isResolved` threads, and threads whose last comment is mine
(already answered). Keep `isOutdated` threads but flag them — the code moved;
the remark may be obsolete.

Distinguish authors: `AccorCorentin` (or any human) = team review;
`Copilot`/`github-actions` = bot — same sorting grid, but lower weight when in
doubt.

## 2. Verify before sorting

Never sort on the comment text alone. For every thread, read the **current**
code at the targeted path/line (the `diffHunk` is a snapshot, not the state of
the file). A remark whose root cause disappeared goes to "Caduc", never to
"Demande".

## 3. Sorting grid

| Pack | Criterion |
| --- | --- |
| **Refusé** | Technically wrong, rests on a misreading of the code, contradicts a repo convention (FSD, Clean Arch, RTK, zero narrative comments, `@astore/*` conventions), demands a change outside the PR's scope (→ separate ticket), or is a pure preference with no gain. |
| **Caduc** | Already fixed in a later commit, or `isOutdated` with the root cause gone. |
| **Autofix** | Strictly inert micro-change, applied without asking. **Closed list**: typo, wording/translation key, error message, removal of a narrative comment, unused import or type, missing `const`, prop or key ordering. ≤ ~5 diff lines, one file, zero behavioral effect, nothing to re-read to understand the fix. |
| **Patch** | Everything else that is small but non-inert: rename of a symbol, extraction of a constant or helper, rewrite of a condition, change of a default. The patch is **prepared and shown**, never applied before agreement — including when the remark is `[NIT]` or `[SUGGESTION]`. |
| **Demande** | Changes behavior, structure or contract: real bug, broken invariant, restructuring, added test, API/schema change, security — even when the remark is short. The impact classifies, not the length. |
| **Question** | Expects an answer, not a patch. |

Border rules:

- **Doubt descends one level**: Autofix → Patch → Demande. Never the reverse. A
  change the user has not seen never enters the working tree.
- The tag does not decide: a `[NIT]` or `[SUGGESTION]` touching anything outside
  the closed list goes to Patch.
- A `[BLOCKING]` is never autofixed, even trivial: Demande (or Refusé, argued).
- A `[NIT]` can be Refusé like any other.

## 4. Application

Only the **Autofix** pack touches files. Patches are shown as diffs (output
format §3) and applied only on a per-ref "ok" from the user — approval covers
the refs it names, never the next ones.

- Verify the branch first: `git branch --show-current` must equal the PR's
  `headRefName`. Otherwise **ask** — never checkout or change worktree alone.
- Several PRs of one stack: autofix only the PR we are on; announce the others
  as "waiting for the right branch".
- After applying: baseline `pnpm typecheck && pnpm lint && pnpm test`. Red →
  revert the offending fix and reclassify upward as Demande.
- Atomic Conventional Commits, one per theme (not per comment):
  `fix(menu-compliance): …`, `refactor(api): …`. Never push without explicit
  approval.

## 5. Output format

The output **format** (recap table, per-PR tables, detail blocks, closing) is
single-homed in `output-format.md` next to this file — load it before writing
the synthesis; the grid above feeds its "Verdict" column (`Demande`, `Patch`,
`Autofix`, `Refusé`, `Caduc`, `Question`, in that order).

## 6. Replies and resolution

Propose, don't post. Write in English (repo charter), factual tone, one concrete
reason — especially for Refusés, where silence reads badly. Post only after
agreement:

    gh api repos/:owner/:repo/pulls/<n>/comments/<databaseId>/replies -f body='<reply>'

Resolve a handled thread (thread id, not comment id):

    gh api graphql -f query='mutation($t:ID!){ resolveReviewThread(input:{threadId:$t}){ thread{ isResolved } } }' -F t=<threadId>

Never resolve a thread whose fix is neither pushed nor accepted by the user.
