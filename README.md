# dotfiles

macOS workstation configuration, managed with [chezmoi](https://chezmoi.io) and
a profile-based bootstrap for fresh machines.

## Layout

| Path | Purpose |
|---|---|
| `bootstrap.sh` | Entry point for a new Mac: downloads `bootstrap/` and hands over. |
| `bootstrap/` | Profile logic (`profiles.sh`), package lists (`packages.sh`), post-install configuration (`configure.sh`), shared helpers (`lib.sh`). |
| `bootstrap/tests/` | Offline checks for the bootstrap modules. |
| `dot_*` | Managed configuration: every `dot_` prefix maps to a `~/.` path (`dot_zshrc` → `~/.zshrc`). |
| `.chezmoiignore` | Deny-list: volatile state, secrets and caches that are never versioned. |

`bootstrap/` is itself ignored by chezmoi: it runs from a clone, it is never
applied into `$HOME`.

## Fresh machine

```sh
curl -fsSL https://raw.githubusercontent.com/walid-mos/dotfiles/main/bootstrap.sh -o /tmp/bootstrap.sh \
  && zsh /tmp/bootstrap.sh [--dry-run] [profile]
```

Profiles: `laptop` (default — full setup, fonts, Studio pairing) and `server`
(headless: Tailscale daemon, no sleep, remote login).

The script must run from a real terminal, so it is downloaded to a file first
and never piped into a shell. `--dry-run` prints the full plan without touching
anything.

## Daily use

This checkout (`~/.local/share/chezmoi`) is the single source of truth; live
files are copies. Edit configuration here, then:

```sh
chezmoi diff      # what would change on the machine
chezmoi apply     # push the repo state to $HOME
chezmoi re-add    # absorb a live edit back into the repo
chezmoi update    # pull and apply in one step
```

Secrets (`~/.config/zsh/secrets`, ssh keys, tokens) stay outside the repo by
design and are scaffolded, never versioned.

## Checks

```sh
zsh bootstrap/tests/downloader.sh   # bootstrap modules load and validate arguments
zsh bootstrap/tests/*.sh            # every bootstrap test
```
