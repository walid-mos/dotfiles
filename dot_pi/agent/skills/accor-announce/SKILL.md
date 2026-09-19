---
name: accor-announce
description: >-
    Compose the Teams announcement message for PRs under review from PR numbers
    only ("fais le message teams pour la 132", "prévins l'équipe des PR à review")
    in accor-hotels/product-data-apps: fetch title/description/diff via gh,
    detect stacked PRs, copy it as rich HTML to the macOS clipboard so Cmd+V
    yields real bullets.
---

# accor-announce — Teams PR announcement, rich-HTML clipboard

Input: one or more PR numbers. Output: the message copied to the clipboard as
rich HTML — Cmd+V in Teams gives real bullets.

## 1. Collect

One `gh` call per requested PR — all before writing anything:

    for n in <numéros>; do
      gh pr view "$n" --json number,title,url,body,baseRefName,headRefName,files
    done

Default repo: the one in the cwd; otherwise `--repo accor-hotels/product-data-apps`.

If `body` is empty or hollow, read the diff (`gh pr diff <n> --name-only`, and
the full diff when paths are not enough): the message describes what the PR
**does**, not what its description *claims*.

## 2. Order and stacks

A PR is **stacked** on another when its `baseRefName` is the `headRefName` of
another PR in the batch (or when its description says "empilée sur #X"). Then:

- order from base to top;
- number `PR 1/2`, `PR 2/2`, etc.

Independent PRs: **no `PR x/y` line at all.** Never number PRs that have no
base link between them, even when posted together.

## 3. Format

    <raw URL>
    PR 1/2
    - <content line>
    - <content line>

    <raw URL>
    PR 2/2
    - <content line>

Hard rules:

- **Raw URL alone on its first line.** The script turns it into an HTML link.
  Never a markdown `[text](url)`.
- Every content line starts with `- ` (dash + space). That marker is what the
  script transforms into `<li>` — do not substitute a Teams bullet.
- No `#`, no `*`, no bold, no tables, no backticks, no `•`.
- `PR x/y` without a bullet, between the URL and the list.
- One empty line between two PRs, never inside one.
- Do not repeat the URL at the end, do not add a header or a sign-off formula
  ("Salut à tous", "merci d'avance") — the user adds those themselves.

## 4. Content lines

One to four lines per PR. Telegraphic style, French (the deliverable), no final
punctuation:

- nominal fragments, no conjugated sentences: « Partie API / BDD pour le crud
  Categories », « Correctifs visuel tailwind », « Suppression page temporaire
  Upload S3 »;
- one idea per line, in reviewer-importance order;
- `->` for a consequence or a precision that changes the reading: «
  Finalement 4 segments et non pas 2 -> chaque segment a ses propres produits »;
- functional vocabulary (what it changes for the product), no implementation
  detail: no file names, no paths, no component names — unless it *is* the
  subject ("Refactor hook activeWorkspace");
- flag the front/API pairing when the PR covers only one side of a pair
  (« API side », « Front side »);
- flag any touch of a shared package (`packages/ui`) or any deletion — that
  orients the reviewer.

Not included: test counts, green baseline, checklist items, choice
justifications. The PR description carries all that; the Teams message only
makes a reviewer click.

## 5. Output

Teams applies markdown (`- item`) **only while typing**. A paste of `- item` or
`• item` stays plain text. The only paste that produces real bullets is rich
HTML in the clipboard.

1. Build the block per §3.
2. Pipe it to the script (relative to **this skill's directory**; full path:
   `~/.pi/agent/skills/accor-announce/scripts/copy-to-teams.sh`):

       printf '%s\n' "<bloc>" | bash scripts/copy-to-teams.sh

3. Show a preview of the block in a code fence (for review only — do **not**
   ask the user to copy it).
4. One line outside the fence: "déjà dans le presse-papiers — Cmd+V dans
   Teams", plus a review-order note when it is a stack. Nothing else.

If the script fails: say so — never invent a markdown fallback.
