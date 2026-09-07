---
name: dotfiles-sync
description: >-
    Sync dotfiles changes into the chezmoi source repo: add new config files,
    re-add modified ones, commit and push. Use when the user asks to update,
    save, back up, or sync dotfiles or configuration.
---

# Dotfiles Sync

Keep the chezmoi source repo (`~/.local/share/chezmoi`, remote `walid-mos/dotfiles`) in sync with the live config. chezmoi runs in the default (copy) model: the source is the single truth, live files are copies.

## Procedure

**1. Scope.** List managed top-level targets:

```bash
chezmoi managed | cut -d/ -f1 | sort -u
```

Only work inside these trees. Bringing a NEW top-level folder under management requires explicit user confirmation first.

**2. Candidates.**

- New files: `chezmoi unmanaged` (it already respects `.chezmoiignore`)
- Modified managed files: `chezmoi status`

**3. Classify** every candidate against `.chezmoiignore` in the source repo:

- Legitimate config → propose ADD
- Volatile (state, caches, logs, sessions, `node_modules`, binaries, secrets, tokens, credentials, `*.local`) → propose adding a pattern to `.chezmoiignore`
- Ambiguous → ask the user

Never re-ignore something already ignored; never remove an ignore entry without asking.

**4. Confirm.** Present a summary table (ADD / RE-ADD / IGNORE with full paths), then wait for explicit approval. Deny-list beats everything: a file matching `.chezmoiignore` is never committed, even if the user says "add everything".

**5. Execute.**

```bash
chezmoi add <dest-paths...>        # new files (enumerate targets, never a whole tree)
chezmoi re-add <dest-paths...>     # modified managed files
# update .chezmoiignore if proposed (grouped under a comment)
chezmoi git -- add -A
chezmoi git -- commit -m "<scope>: <summary>"
chezmoi git -- push
```

## Rules

- Never `chezmoi add` a whole directory blindly - enumerate leaf targets (`node_modules` trap).
- Secrets/tokens/credentials: never add, never echo content, never commit.
- Commit message: imperative, one line, scope prefix (`pi:`, `ghostty:`, `config:`).
- The deny-list lives in the repo (`.chezmoiignore`), not in this skill - keep it that way.
