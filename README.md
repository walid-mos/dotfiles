# dotfiles

macOS workstation configuration, managed with [chezmoi](https://chezmoi.io) and
a profile-based bootstrap for fresh machines.

## Layout

| Path | Purpose |
|---|---|
| `bootstrap.sh` | Entry point for a new Mac: downloads `bootstrap/` and hands over. |
| `bootstrap/` | Profile logic (`profiles.sh`), package lists (`packages.sh`), post-install configuration (`configure.sh`), shared helpers (`lib.sh`). |
| `bootstrap/tests/` | Offline checks for the bootstrap modules. |
| `macbook/` | MacBook-only tools kept in the repo, never applied: installed by hand (see [MacBook display switcher](#macbook-display-switcher)). |
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

## MacBook display switcher

`macbook/uc-resolution/` holds the MacBook Pro's resolution switcher. `.chezmoiignore` keeps it out of `$HOME` on every machine, so `chezmoi apply` never installs it: copy it by hand on the MacBook.

It switches the built-in screen between two resolutions: one while the MacBook is linked to the Mac Studio, one otherwise. Each case remembers its own resolution: when a case ends, the screen's current mode is saved to that case's file, and the other case's saved mode is applied.

Signal: Universal Control's `IDS <id>: Connected` / `IDS <id>: Disconnected` lines, read with `log stream` (subsystem `com.apple.universalcontrol`, category `EVNT`).

| Repo file | Installed at |
|---|---|
| `switcher.sh` | `~/Library/Application Support/uc-resolution/switcher.sh` |
| `com.walid-mos.uc-resolution.plist` | `~/Library/LaunchAgents/com.walid-mos.uc-resolution.plist` (starts at login, restarted if it exits) |

State, in `~/Library/Application Support/uc-resolution/`:

| File | Holds |
|---|---|
| `state` | the case last applied: `connected` or `disconnected` |
| `connected.mode`, `disconnected.mode` | the remembered `displayplacer` mode of each case |
| `transition.log` | one timestamped line per switch |

It needs `displayplacer` (`brew install displayplacer`); `SCREEN_ID` in `switcher.sh` is the built-in screen's persistent id from `displayplacer list`.

On the MacBook, from this checkout (`cd "$(chezmoi source-path)"`):

```sh
# install
D="$HOME/Library/Application Support/uc-resolution"
mkdir -p "$D"
cp macbook/uc-resolution/switcher.sh "$D/"
cp macbook/uc-resolution/com.walid-mos.uc-resolution.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.walid-mos.uc-resolution.plist

# reload after copying a new switcher.sh
launchctl kickstart -k gui/$(id -u)/com.walid-mos.uc-resolution

# uninstall (the last line also forgets the remembered modes)
launchctl bootout gui/$(id -u)/com.walid-mos.uc-resolution
rm ~/Library/LaunchAgents/com.walid-mos.uc-resolution.plist
rm -r "$HOME/Library/Application Support/uc-resolution"
```

After changing the plist, run `launchctl bootout` then `launchctl bootstrap` instead of `kickstart`.
