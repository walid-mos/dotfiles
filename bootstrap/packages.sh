#!/bin/zsh
# packages.sh - package lists and installers.
#
# To install something new, add an entry to the arrays below; the installers
# pick it up automatically. Each installer is safe to call on an
# already-set-up machine: it reports and skips when the tool is present.

BREW_FORMULAS=(neovim chezmoi gh starship zoxide fastfetch fzf ripgrep zsh-syntax-highlighting)
BREW_CASKS=(ghostty brave-browser anomalyco/tap/hex)
BREW_TAPS=(anomalyco/tap)
# GUI launcher for the laptop: the bootstrap disables Spotlight's cmd+space
# hotkeys, so an actual launcher must be installed alongside them.
LAPTOP_CASKS=(tailscale-app vicinae)
SERVER_FORMULAS=(tailscale)

NERD_FONTS_SOURCE="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Fonts/Nerd Font"
PI_PACKAGE="@earendil-works/pi-coding-agent"

install_homebrew() {
    if command_exists brew; then
        skip "Homebrew already installed"
        return 0
    fi
    act "install Homebrew" sh -c 'NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
    is_dry_run || eval "$(/opt/homebrew/bin/brew shellenv)"
}

# ensure_brew_taps - third-party taps needed by BREW_CASKS (e.g. anomalyco/tap
# for the Hex cask). brew auto-taps on install, but tapping first keeps the
# per-cask `brew list` idempotence checks working.
ensure_brew_taps() {
    for tap in "${BREW_TAPS[@]}"; do
        if brew tap-info "$tap" >/dev/null 2>&1; then
            skip "tap $tap already added"
        else
            act "add brew tap $tap" brew tap "$tap"
        fi
    done
}

# ensure_brew_trust - Homebrew 7 refuses to load a cask from a third-party tap
# until that cask is trusted. The casks already name their tap ('tap/name'),
# so the trust list is derived from the cask lists instead of duplicated.
ensure_brew_trust() {
    local trusted entry
    trusted=$(brew trust --json v1 2>/dev/null) || trusted=""
    for entry in "${BREW_CASKS[@]}" "${LAPTOP_CASKS[@]}"; do
        [[ "$entry" == */* ]] || continue
        if printf '%s' "$trusted" | grep -q "\"$entry\""; then
            skip "$entry already trusted"
        else
            act "trust cask $entry" brew trust --cask "$entry"
        fi
    done
}

# install_brew_package <formula|cask> <name>
install_brew_package() {
    kind="$1"
    name="$2"
    if brew list "--$kind" "$name" >/dev/null 2>&1; then
        skip "$name already installed"
        return 0
    fi
    act "install $name ($kind)" brew install "--$kind" "$name"
}

# install_brew_list <formula|cask> <name...>
install_brew_list() {
    kind="$1"
    shift
    for name in "$@"; do
        install_brew_package "$kind" "$name"
    done
}

install_pnpm() {
    if command_exists pnpm; then
        skip "pnpm already installed"
        return 0
    fi
    act "install pnpm" sh -c 'curl -fsSL https://get.pnpm.io/install.sh | sh -'
    # The installer writes its binaries under $PNPM_HOME/bin (pnpm, node, ...),
    # so PATH needs that directory, not $PNPM_HOME itself.
    export PNPM_HOME="$HOME/Library/pnpm"
    export PATH="$PNPM_HOME/bin:$PATH"
}

install_node() {
    if command_exists node; then
        skip "node already installed"
        return 0
    fi
    act "install node LTS via pnpm" pnpm runtime set node lts -g
}

install_pi() {
    if command_exists pi; then
        skip "pi already installed (upgrade with: pnpm add -g $PI_PACKAGE)"
        return 0
    fi
    act "install pi-coding-agent" pnpm add -g --ignore-scripts "$PI_PACKAGE"
}

# install_npm - pnpm >= 11 installs a Node runtime without npm/npx/corepack,
# so npm is added explicitly. Lives in $PNPM_HOME/bin, already on PATH.
install_npm() {
    if command_exists npm; then
        skip "npm already installed"
        return 0
    fi
    act "install npm" pnpm add -g npm
}

install_herdr() {
    if command_exists herdr || [ -x "$HOME/.local/bin/herdr" ]; then
        skip "herdr already installed"
        return 0
    fi
    act "install herdr" sh -c 'curl -fsSL https://herdr.dev/install.sh | sh -'
    # The installer drops the binary in ~/.local/bin, which a fresh bootstrap
    # shell does not have on PATH yet - later herdr calls need it now.
    export PATH="$HOME/.local/bin:$PATH"
}

# install_tailscale_daemon - server profile only: tailscaled as a boot-time
# root LaunchDaemon, so the mesh comes up without any GUI session. Auth still
# needs one manual `sudo tailscale up` (browser) - see configure_server_reminders.
install_tailscale_daemon() {
    install_brew_list formula "${SERVER_FORMULAS[@]}"
    if brew services list | awk '{print $1, $2}' | grep -q '^tailscale started$'; then
        skip "tailscaled service already running"
        return 0
    fi
    act "start tailscaled as a boot-time daemon" sudo brew services start tailscale
}

# install_nerd_fonts copies fonts from iCloud - laptop profile only, and
# silently skipped when iCloud Drive is not signed in.
install_nerd_fonts() {
    if [ ! -d "$NERD_FONTS_SOURCE" ]; then
        skip "iCloud Nerd Font folder not found"
        return 0
    fi
    if is_dry_run; then
        would "copy Nerd Fonts from iCloud"
        return 0
    fi
    run "copying Nerd Fonts from iCloud"
    mkdir -p "$HOME/Library/Fonts"
    rsync -am --include='*/' \
        --include='*.otf' --include='*.ttf' --include='*.otc' --include='*.ttc' --exclude='*' \
        "$NERD_FONTS_SOURCE/" "$HOME/Library/Fonts/"
}
