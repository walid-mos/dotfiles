---
name: accor-comment
description: >-
    Format one raw remark into a review comment that conforms to the repo's
    CODE_REVIEW_CHARTER and post it inline on a GitHub PR of
    accor-hotels/product-data-apps. Use when the user gives a file/line (+ a raw
    comment, in FR or EN) to turn into a proper review comment, or asks to post
    a review comment on a PR ("poste ce commentaire sur la 130", "react to that
    properly in review").
---

# accor-comment — charter-compliant review comment, posted inline

Turn a raw remark into a charter-compliant PR review comment, then post it
inline. Self-contained: everything from `.github/CODE_REVIEW_CHARTER.md` that
matters for writing a comment is inlined below — do not re-read the charter.
Exception: if anything hints the repo changed the charter since, re-read
`.github/CODE_REVIEW_CHARTER.md` first and reconcile.

## Input the user gives

- File path (+ line, or a line range) — or a PR number if not obvious.
- Their raw comment, in FR or EN.

If the target PR is not clear, ask (or infer from the current branch:
`gh pr view --json number`).

## Output rules (the charter, distilled)

1. **Write in English.** Always, whatever language the user wrote in.
2. **Prefix every comment** with exactly one intent tag:

   | Prefix | Use when |
   | --- | --- |
   | `[BLOCKING]` | must be fixed before merge (bug, crash, security, broken invariant) |
   | `[SUGGESTION]` | improvement idea, not required |
   | `[QUESTION]` | seeking clarification; an answer is expected |
   | `[NIT]` | minor style/formatting detail |
   | `[DISCUSSION]` | broader topic for the team |

   Pick the weakest tag that fits. A personal preference is `[SUGGESTION]` or
   `[NIT]`, never `[BLOCKING]` — don't block on preference.
3. **Review the code, never the person.** No "why did you", no "this is wrong".
   State the problem, then the fix.
4. **Be specific and actionable.** Name the concrete failure case; give a
   concrete direction or code snippet. Every comment should be answerable with
   an action.
5. **Distinguish blocking from optional in the wording itself** (e.g.
   "Not blocking — fine to keep as-is").
6. **Keep it tight.** One issue per comment. No preamble, no restating the diff.

Shape to aim for: `[TAG] <what's wrong + concrete failure case>. <fix /
direction, optionally a snippet>. <blocking-or-not>.`

## Posting inline

Confirm the formatted comment with the user first, then post:

    gh api repos/:owner/:repo/pulls/<PR>/comments \
      -f body='<formatted comment>' \
      -f commit_id="$(gh pr view <PR> --json headRefOid -q .headRefOid)" \
      -f path='<file path>' \
      -F line=<line> -f side=RIGHT -q '.html_url'

- Multi-line range: add `-F start_line=<n> -f start_side=RIGHT`.
- Return the `.html_url` to the user.
- For a general (non-line) comment: `gh pr comment <PR> --body '<comment>'`.
