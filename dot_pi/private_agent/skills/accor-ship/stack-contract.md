# Stack contract — slicing & link mechanics

Extends `accor-ship` Phase 2 (slicing) and Phase 4 (submit mechanics); the Accor
constraints are applied here, on top of the defaults — never restated in either
phase. A **link** is one branch + one PR; the stack is an ordered sequence of
links. Apply this contract once the scope is gathered.

## Defaults

- **One coherent feature = one link.** A feature or CRUD that is one product unit
  stays one link, even if it spans API + UI or several tickets.
- **A sequential stack ≠ parallelism.** Links exist so each one is readable and
  testable alone, in dependency order. Never to fan work out across agents.
- **Ordered dependencies are preserved.** A link depends only on links below it.
  Do not reorder around a blocking edge.

## Soft budgets

`--max-files` (default **20**) and `--max-lines` (default **1000**) are soft
ceilings for readability, not split triggers.

- Exceed them rather than cut a coherent unit or leave a red / uncompilable /
  untestable link.
- Never split into an incoherent or red state to honor a budget.
- An overrun is allowed and called out in the plan; it never fragments a CRUD or
  a tightly coupled pair (schema + its config; API + the only UI exercising it).

## When to add another link

Split (or keep work apart) only when the result is still a coherent, compilable,
reviewable feature **and** one of:

- a hard dependency order (foundation before consumer);
- two product units that are independently meaningful and testable;
- a mid-run overflow closable as a complete link without abandoning a red parent.

Do **not** split by mechanical layer (schema → validation → wiring → UI) or by
CRUD verb just to shrink a diff. Do **not** isolate a trivial ticket as its own
PR when it belongs to the same feature.

## Output before building

Ordered links: branch slug, contents, estimated files/lines (overruns flagged),
test commands, **the AC rows allocated to each link**. Then build bottom-up.

## Link mechanics (no gh-stack)

- **Fix-on-origin**: a fix/refactor applies on the link that **introduced** the
  file, never on a downstream link. Before committing inside a stack:
  `git log --all --source -- <file>` finds the origin branch; commit **there**,
  then rebase each downstream link in order and re-run their baseline.
  Never commit an API fix on the view link.
- **Restack after every propagation**, then re-verify the affected links (suite
  green each time).

## Stacked PRs (submit)

Manual replacement for `gh stack submit`, bottom-up:

1. `gh pr create --base develop --head <link-1>`; then each next link:
   `gh pr create --base <previous-link-branch> --head <link-N>`. Push first;
   title, commits and body per accor-conventions §1 and the
   `.github/PULL_REQUEST_TEMPLATE.md` compliance demanded by `accor-ship`
   Phase 4.
2. Merge the stack **bottom-up**, as an explicit human gate — never auto-merge.
3. `--no-stack`: one branch, one PR against `--base`; same template discipline.
