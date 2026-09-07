# lib.sh - logging, dry-run switch, and guards shared by all bootstrap modules.

DRY_RUN=0

# Logging - one symbol per line type:
#   step  ==>  major phase          skip  (already installed)
#   run   +   doing something       would (dry-run plan)
#   ok    check  done               die   error and abort
step()  { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
run()   { printf '  \033[1;36m+\033[0m %s\n' "$1"; }
ok()    { printf '  \033[1;32m\xe2\x9c\x94\033[0m %s\n' "$1"; }
skip()  { printf '  \033[2;33m\xe2\x97\x8b\033[0m %s\n' "$1"; }
would() { printf '  \033[2;36m~\033[0m would: %s\n' "$1"; }
die()   { printf '\033[1;31merror:\033[0m %s\n' "$1" >&2; exit 1; }

command_exists() { command -v "$1" >/dev/null 2>&1; }
is_dry_run()     { [ "$DRY_RUN" -eq 1 ]; }

# act <message> <command...> - the only place that decides between plan and
# execution: in dry-run, print what would happen; otherwise announce and run.
act() {
    message="$1"
    shift
    if is_dry_run; then
        would "$message"
        return 0
    fi
    run "$message"
    "$@"
}

# Installers prompt for input (Homebrew RETURN prompt, sudo password), so the
# setup must run from a file in a real terminal - never piped into a shell.
require_interactive_terminal() {
    if [ ! -t 0 ]; then
        die "stdin is not a terminal. Do not pipe this script into a shell.
       Download the entry script first, then run it from a file."
    fi
}

# Ask for the sudo password once, up front, then keep the ticket alive in the
# background so long downloads (casks) don't fail mid-install.
SUDO_KEEPALIVE_PID=""

keep_sudo_alive() {
    while sudo -n true 2>/dev/null; do
        sleep 60
    done
}

ensure_sudo() {
    if is_dry_run; then
        would "request administrator rights"
        return 0
    fi
    run "requesting administrator rights (sudo password may be asked)"
    sudo -v
    keep_sudo_alive &
    SUDO_KEEPALIVE_PID=$!
    trap 'kill "$SUDO_KEEPALIVE_PID" 2>/dev/null || true' EXIT
}