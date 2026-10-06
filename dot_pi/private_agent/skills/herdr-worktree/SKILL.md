---
name: herdr-worktree
description: Create or open a Herdr subworkspace and Git worktree from free-text intent. Use for /worktree, requests to fork the current checkout, or requests to resume a branch in a Herdr subworkspace. Fuzzy-match existing branches first and confirm matches before opening them. Start interactive Pi in each newly opened subworkspace.
---

# Herdr worktree

Treat the entire argument as free text, not a literal branch name. Execute the following workflow; the prompt template is only an entry point.

## Resolve the target

1. Confirm caller context with `herdr workspace get "$HERDR_WORKSPACE_ID"` and the inherited `HERDR_PANE_ID`. Missing `HERDR_ENV` alone does not establish that the session is outside Herdr. If caller IDs are missing or the workspace lookup fails, stop with the exact failure; do not target the UI-focused workspace or manufacture environment values.
2. In the caller's checkout, batch current branch, `HEAD`, short status, and local/cached remote branch names using Git. Use `git for-each-ref --format='%(refname:short)' refs/heads refs/remotes` for candidates. Exclude remote HEAD aliases, collapse local/tracking duplicates, and do not fetch. Save long output in an OS-temp file and read bounded portions. Uncommitted changes stay in the original checkout; mention them if present.
3. Match the free text against branch names with model judgment: ticket IDs, intent, wording, abbreviations, and likely typos. Prefer exact ticket matches over generic word overlap. Inspect a shortlisted branch's recent commit subjects only when names are insufficient. Do not invent matches. With no argument, skip matching and fork the current HEAD.
4. If one or more plausible branches exist, call `ask_user_question` once with id `target_branch`. Show up to three candidate branch names, recommend the strongest, and include “Create a new branch from current HEAD” and “Cancel”. Ask whether a candidate is the intended branch, even for an exact match. Do not mutate anything while the answer is pending. Cancellation stops the workflow. A confirmed branch uses its own tip, not the caller's HEAD.
5. If there is no plausible match, or the user chose creation, derive a branch name from the free text without another question: `<type>/<ticket-if-present>-<kebab-description>`, omitting the ticket segment when absent. Choose the dominant type (`feat`, `fix`, `chore`, `docs`, `refactor`, or `test`); preserve ticket spelling. Load repository-specific branch conventions when applicable. With no text, derive the description from the current branch, using `worktree` for detached HEAD. Ensure a distinct unused name, appending `-worktree-<YYYYMMDD-HHMMSS>` only for a collision. Validate with `git check-ref-format --branch <name>`. Capture the caller's HEAD as the new branch's base; do not switch to develop or pull.

## Open the worktree

Use `herdr worktree list --workspace "$HERDR_WORKSPACE_ID"` to resolve the chosen branch's checkout.

- **Confirmed branch already checked out:** run `herdr worktree open --workspace "$HERDR_WORKSPACE_ID" --path '<existing-checkout>' --label '<branch>' --focus`. Reuse its checkout and any existing subworkspace; do not force a duplicate checkout. If it is the caller's checkout, explain that it is already open rather than manufacture another worktree.
- **Confirmed branch not checked out:** create and open a worktree on that branch. For a remote-only match, first create its local tracking branch with `git branch --track '<local-name>' '<confirmed-remote-ref>'`, after checking for local-name conflicts. Capture the confirmed branch tip as the base.
- **New branch:** create and open a worktree from the captured caller commit.

For creation, run once with the resolved local branch and base:

```bash
herdr worktree create --workspace "$HERDR_WORKSPACE_ID" --branch '<branch>' --base '<captured-commit>' --label '<branch>' --focus
```

Let Herdr choose the path. Read workspace ID and checkout path from returned JSON. On error, inspect the reported state before retrying; do not grant repository trust automatically.

## Start Pi and verify

Verify `herdr workspace get <returned-workspace-id>` shows the checkout, `git -C <checkout> branch --show-current` names the chosen branch, and its HEAD equals the captured base.

When creation or opening returns a new subworkspace, start interactive Pi in the returned `root_pane.pane_id` after these checks. Use `herdr agent list` to choose an unused name matching `[a-z][a-z0-9_-]{0,31}`, derived from the returned workspace ID, then run:

```bash
herdr agent start <unique-name> --kind pi --pane <returned-root-pane-id>
```

This command waits for Pi to be detected and ready for input. Verify `herdr agent get <unique-name>` identifies Pi in that pane. Leave it at its interactive prompt; do not submit the ticket or begin implementation. If startup fails or is blocked, inspect `herdr agent get` and `herdr agent read` and report the remaining action without blindly relaunching or answering approval dialogs.

For an already-open subworkspace, preserve its running processes and agents; do not start a second Pi or replace an occupied pane.

Report the branch, path, and verified Pi readiness concisely, distinguishing creation from reuse. Install dependencies, copy environment files, or start services only when requested.
