# Dotfiles (chezmoi source)

chezmoi source of the live config. The Mac Studio is the truth and pushes with the `dotfiles-sync` skill; the MacBook Pro is a copy and pulls with `dotfiles-pull`. Those skills own the add / re-add / forget procedure; this file owns the repository rules.

## Guarantees

- No secret, token, session, cache or machine-local state is versioned: each one matches a pattern in `.chezmoiignore`. Add the pattern before adding a neighbouring file.
- Repository-only files never reach `$HOME`: this file, `README.md` and `bootstrap/` are listed in `.chezmoiignore` under "repository documentation". Add any new repository-only file there.

## Git flow

- Commit on a branch (`sync/<machine>-<yyyy-mm>` for a sync), one Conventional Commit (`type(scope): description`) per intention.
- Never open a pull request or merge with `--no-ff` here: `git merge --ff-only` the branch into `main`, then delete the local branch.
- Never leave a merged branch on origin or locally: after pushing `main`, `git push origin --delete <branch>` and `git branch -d <branch>`. `wt-archive` is an archive: never merge or delete it.
