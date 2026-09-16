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

# install_pi_extensions - pi installs its user-scoped npm packages on its first
# run; doing it here means an unusable extension tree fails the setup instead of
# breaking the first agent session. Must run after apply_dotfiles: the layout pi
# leaves behind depends on the managed ~/.pi/agent/npm/pnpm-workspace.yaml.
install_pi_extensions() {
    if ! command_exists pi; then
        skip "pi not installed; leaving its extensions alone"
        return 0
    fi
    if pi_extensions_usable "$HOME/.pi/agent"; then
        skip "pi extensions already usable"
        return 0
    fi
    if is_dry_run; then
        would "install pi extensions (pi update --extensions)"
        return 0
    fi
    run "install pi extensions"
    # pi refreshes its local-path packages too, which a fresh machine does not
    # have yet: that failure must not abort the setup - the check below decides
    # whether the npm-scoped packages actually landed.
    if ! pi update --extensions; then
        printf '  %s\n' "pi update --extensions failed (see above)"
    fi
    if ! pi_extensions_usable "$HOME/.pi/agent"; then
        die "pi extensions are still unusable after 'pi update --extensions'"
    fi
    ok "pi extensions installed"
}

# pi_extensions_usable <agent dir> - every "npm:" package declared in
# settings.json must be a real directory under <agent>/npm/node_modules with its
# runtime dependencies as real siblings: pi's loader does not resolve symlinks,
# so a pnpm store layout (or a missing dependency) makes the extension fail with
# "Cannot find module '<dep>'".
pi_extensions_usable() {
    command_exists node || return 0 # pi runs on node; nothing to judge without it
    node -e '
        const fs = require("fs"), path = require("path");
        const agent = process.argv[1];
        const settings = path.join(agent, "settings.json");
        if (!fs.existsSync(settings)) process.exit(0);
        const declared = JSON.parse(fs.readFileSync(settings, "utf8")).packages || [];
        const names = declared
            .filter((entry) => typeof entry === "string" && entry.startsWith("npm:"))
            .map((entry) => entry.slice("npm:".length));
        const root = path.join(agent, "npm", "node_modules");
        const problems = [];
        for (const name of names) {
            const dir = path.join(root, name);
            const manifest = path.join(dir, "package.json");
            const entry = fs.lstatSync(dir, { throwIfNoEntry: false });
            if (entry && entry.isSymbolicLink()) {
                problems.push(`${name}: pnpm store symlink, not a real directory`);
                continue;
            }
            if (!fs.existsSync(manifest)) {
                problems.push(`${name}: not installed`);
                continue;
            }
            const deps = Object.keys(JSON.parse(fs.readFileSync(manifest, "utf8")).dependencies || {});
            const missing = deps.filter((dep) => !fs.existsSync(path.join(root, dep)));
            if (missing.length > 0) problems.push(`${name}: unresolvable dependencies: ${missing.join(", ")}`);
        }
        for (const problem of problems) console.log(`  ${problem}`);
        process.exit(problems.length > 0 ? 1 : 0);
    ' "$1"
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
    # The installer drops the binary in ~/.local/bin, which a fresh bootstrap
    # shell does not have on PATH yet - later herdr calls need it now. On an
    # already-provisioned machine this is the only thing to do here.
    export PATH="$HOME/.local/bin:$PATH"
    if command_exists herdr; then
        skip "herdr already installed"
        return 0
    fi
    act "install herdr" sh -c 'curl -fsSL https://herdr.dev/install.sh | sh -'
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
