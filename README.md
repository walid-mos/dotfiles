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

| Path | Runs for | Role |
|---|---|---|
| `~/.zshenv` | every shell (scripts, hooks, ssh exec) | XDG dirs, tool variables, `fpath`, then `env/path.zsh`, `secrets`, `env/infisical.zsh` |
| `~/.zprofile` | login shells | `brew shellenv`, `env/path.zsh` again (after `path_helper`), launchd `PATH` for GUI apps |
| `~/.zshrc` | interactive shells | autoloads `functions/`, sources `rc/` stage by stage, then `aliases.zsh` and `local.zsh` |
| `~/.config/zsh/env/path.zsh` | via the two above | the only definition of `PATH` precedence: shims > pnpm > Homebrew > cargo > system > boat > `~/.local/bin` |
| `~/.config/zsh/env/infisical.zsh` | via `.zshenv` | exports the Infisical secrets from `~/.cache/zsh/infisical.env`, refreshes it in the background |
| `~/.config/zsh/rc/<stage>/*.zsh` | interactive | stages in the order `.zshrc` lists them: `terminal`, `completion`, `tools`, `highlighting`; files inside a stage are order-free |
| `~/.config/zsh/functions/*` | on first call | one autoloaded command per file, named after it |
| `~/.config/zsh/aliases.zsh` | interactive | aliases only |
| `~/.config/zsh/secrets` | every shell | untracked, mode 600, scaffolded by `bootstrap/configure.sh` |
| `~/.config/zsh/local.zsh` | interactive | untracked machine-local extras, optional |

A new tool is one file in `rc/tools/`; a new ordering constraint is a new stage folder plus its name in the `.zshrc` list; environment goes in `.zshenv`. Never an installer block appended to a startup file. `.chezmoiremove` lists former paths so `chezmoi apply` cleans them on every machine.
