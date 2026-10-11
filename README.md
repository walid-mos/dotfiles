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

## zsh

| File | Runs for | Role |
|---|---|---|
| `~/.zshenv` | every shell (scripts, hooks, ssh exec) | XDG dirs, tool variables, `fpath`, then `path.zsh`, `secrets`, `infisical.zsh` |
| `~/.zprofile` | login shells | `brew shellenv`, `path.zsh` again, launchd `PATH` for GUI apps |
| `~/.zshrc` | interactive shells | autoloads `functions/`, sources `conf.d/*.zsh`, `aliases.zsh`, `local.zsh` |
| `~/.config/zsh/path.zsh` | via the two above | the only definition of `PATH` precedence: shims > pnpm > Homebrew > cargo > system > boat > `~/.local/bin` |
| `~/.config/zsh/infisical.zsh` | via `.zshenv` | exports the Infisical secrets from `~/.cache/zsh/infisical.env` |
| `~/.config/zsh/conf.d/*.zsh` | interactive | one tool or concern per file, alphabetical; only `00-` and `zz-` carry an order |
| `~/.config/zsh/functions/*` | on first call | one autoloaded command per file, named after it |
| `~/.config/zsh/secrets` | every shell | untracked, mode 600, scaffolded by `bootstrap/configure.sh` |
| `~/.config/zsh/local.zsh` | interactive | untracked machine-local extras, optional |

Adding a tool means one new file in `conf.d/` (interactive) or one line in `.zshenv` (environment); never an installer block appended to a startup file. `.chezmoiremove` lists the former names of renamed files so `chezmoi apply` cleans them on every machine.
