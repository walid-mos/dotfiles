# configure.sh - post-install configuration: dotfiles and macOS defaults.

DOTFILES_REPO="walid-mos/dotfiles"

# Spell-check keys macOS 14+ stores per input source in HIToolbox, where
# they override the global domain - mirrored by disable_input_source_spellcheck.
SPELL_CHECK_KEYS=(NSAutomaticSpellingCorrectionEnabled)
PLIST_BUDDY="/usr/libexec/PlistBuddy"
HITOOLBOX_PLIST="${HITOOLBOX_PLIST:-$HOME/Library/Preferences/com.apple.HIToolbox.plist}"

apply_dotfiles() {
    if [ ! -d "$HOME/.local/share/chezmoi/.git" ]; then
        act "initialize dotfiles from $DOTFILES_REPO" chezmoi init "$DOTFILES_REPO"
    else
        skip "dotfiles already initialized"
    fi
    if is_dry_run; then
        would "apply dotfiles (diff below)"
        # --force: skip the interactive per-file prompts; --dry-run keeps it
        # read-only and prints what would change.
        chezmoi apply --dry-run --force
        return 0
    fi
    sync_status=$(chezmoi status 2>/dev/null)   # 'status' is read-only in zsh
    # Directional sync from `chezmoi status` line codes (col 1 = X = repo
    # side changed since last apply, col 2 = Y = live side changed since
    # last apply; target starts at col 4 - raw substr, not awk fields, or
    # the leading space of ' M' codes is lost):
    #   live ahead  -> re-add (absorb into repo)
    #   repo ahead  -> apply (update live)
    #   both ahead  -> conflict, skip and let the user decide
    conflicts=$(printf '%s\n' "$sync_status" | awk 'substr($0,1,1) == "M" && substr($0,2,1) == "M" {print substr($0,4)}')
    live_edits=$(printf '%s\n' "$sync_status" | awk 'substr($0,2,1) == "M" && substr($0,1,1) != "M" {print substr($0,4)}')
    if [ -n "$live_edits" ]; then
        run "syncing live edits into the repo"
        act "re-add live-edited files" chezmoi re-add ${=live_edits}
    fi
    if [ -n "$conflicts" ]; then
        skip "changed on both repo and live sides since the last sync - left untouched:"
        printf '      %s\n' ${(f)conflicts}
        ok "resolve with 'chezmoi diff' then 'chezmoi re-add <file>' (or edit the repo)"
        apply_args=$(comm -23 <(chezmoi managed | sort) <(printf '%s\n' "${(f)conflicts}" | sort))
        if [ -n "$apply_args" ]; then
            run "applying dotfiles (conflicts skipped)"
            chezmoi apply --force ${=apply_args}
        fi
        return 0
    fi
    run "applying dotfiles"
    chezmoi apply --force
}

# configure_zsh_secrets - scaffold the untracked secrets file sourced by
# .zshenv for every shell (API keys, tokens). Never versioned: the file is
# NOT in the chezmoi source, so applying dotfiles can't create or overwrite
# it - this only scaffolds the template once, then leaves it alone.
configure_zsh_secrets() {
    local secrets_file="$HOME/.config/zsh/secrets"
    if [ -f "$secrets_file" ]; then
        skip "~/.config/zsh/secrets already exists"
        return 0
    fi
    if is_dry_run; then
        would "scaffold ~/.config/zsh/secrets (mode 600)"
        return 0
    fi
    mkdir -p "$HOME/.config/zsh"
    cat > "$secrets_file" <<'EOF'
# ~/.config/zsh/secrets - API keys and tokens (NEVER commit this file).
# Sourced by ~/.zshenv for every shell, including non-interactive ones
# (agent hooks, scripts). One export per line, e.g.:
#   export CLOUDFLARE_API_TOKEN="..."
EOF
    chmod 600 "$secrets_file"
    ok "scaffolded ~/.config/zsh/secrets (add your keys, mode 600)"
}

# start_container_system - server profile only. Apple's container CLI needs
# its API server daemon started once per boot before any `container` command
# works. Registered as a user brew service so it starts now and re-runs
# `container system start` at every login; the CLI also auto-starts the
# daemon on demand, so a live system does NOT imply the service is
# registered - hence the plist check instead of a status ping.
start_container_system() {
    step "Container system"
    if ! command_exists container; then
        skip "container CLI not installed"
        return 0
    fi
    if [ -f "$HOME/Library/LaunchAgents/sh.brew.container.plist" ]; then
        skip "container brew service already registered"
    else
        act "register container brew service (starts now + at login)" \
            brew services start container
    fi
    if container system status >/dev/null 2>&1; then
        skip "container system already running"
    else
        act "start container system" container system start
    fi
    # Formula caveat: the brew service runs `container system start
    # --disable-kernel-install`, so the recommended kernel is never installed
    # by the service - it must be set once by hand. Idempotent via the
    # default-kernel symlink the command creates.
    kernel_link="$HOME/Library/Application Support/com.apple.container/kernels/default.kernel-arm64"
    if [ -L "$kernel_link" ] && [ -e "$kernel_link" ]; then
        skip "recommended container kernel already installed"
    else
        act "install recommended container kernel" \
            container system kernel set --recommended
    fi
}

# configure_development_dirs - create the workspace layout under ~/Development:
# one folder per client, nextnode internal projects, and personal tools.
DEVELOPMENT_DIRS=(clients nextnode tools)

configure_development_dirs() {
    step "Development directories"
    for dir in "${DEVELOPMENT_DIRS[@]}"; do
        if [ -d "$HOME/Development/$dir" ]; then
            skip "~/Development/$dir already exists"
        else
            act "create ~/Development/$dir" mkdir -p "$HOME/Development/$dir"
        fi
    done
}

# --- herdr remote: Mac Studio as the always-on server ---
#
# Server = Mac Studio (headless, runs everything). Clients = MacBooks, which
# only run a thin `herdr --remote studio` client. The MagicDNS name must match the device name Tailscale actually registered for
# the Studio (verified live: mac-studio.tail4df91e.ts.net -> 100.95.191.41).
STUDIO_SSH_ALIAS="studio"
STUDIO_TAILNET_HOST="mac-studio.tail4df91e.ts.net"
STUDIO_TAILNET_DEVICE="mac-studio"

# configure_headless_server - keep the Studio always reachable without a
# display or a logged-in session: never sleep, restart after power failure,
# SSH and Screen Sharing enabled at boot. Requires sudo (ensure_sudo).
configure_headless_server() {
    step "Headless server (pmset + services)"
    act "pmset: no sleep, restart after power failure, Wake-on-LAN" \
        sudo pmset -a sleep 0 disablesleep 1 hibernatemode 0 \
            displaysleep 10 autorestart 1 womp 1
    if is_dry_run; then
        would "ensure Remote Login (SSH) enabled"
        would "ensure Screen Sharing enabled (headless GUI fallback)"
        return 0
    fi
    if [ "$(sudo systemsetup -getremotelogin 2>/dev/null | awk '{print $NF}')" = "On" ]; then
        skip "Remote Login (SSH) already enabled"
    else
        act "enable Remote Login (SSH)" sudo systemsetup -setremotelogin on
    fi
    if sudo launchctl print system/com.apple.screensharing >/dev/null 2>&1; then
        skip "Screen Sharing already enabled"
    else
        act "enable Screen Sharing (headless GUI fallback)" \
            sudo launchctl load -w /System/Library/LaunchDaemons/com.apple.screensharing.plist
    fi
}

# configure_server_reminders - steps that cannot be automated from a script:
# interactive browser auth, a System Settings toggle, and the boot flow habit.
configure_server_reminders() {
    step "Manual steps to finish server setup"
    ok "1. sudo tailscale up --hostname=$STUDIO_TAILNET_DEVICE   (auth in browser)"
    ok "2. System Settings > Privacy & Security > Full Disk Access:"
    ok "   add /usr/libexec/sshd-keygen-wrapper (TCC for SSH sessions)"
    ok "3. after each reboot: ssh in (pre-boot unlock on macOS 26+), then run 'herdr'"
}

# configure_studio_client - laptop profile only: wire the MacBooks to the
# Studio with an SSH Host alias, a one-key herdr attach, and a saved herdr
# machine profile (herdr 0.9+ Machines). The profile is saved on the laptop
# side - the laptop runs the client (its sidebar shows Local + Mac Studio),
# while the Studio never stores a profile of itself. Idempotent, dry-run
# aware; appends to ~/.ssh/config and ~/.config/zsh/local.zsh.
configure_studio_client() {
    step "Mac Studio client (herdr)"
    if grep -qs "Host $STUDIO_SSH_ALIAS" "$HOME/.ssh/config"; then
        skip "~/.ssh/config already has Host $STUDIO_SSH_ALIAS"
    else
        if is_dry_run; then
            would "append Host $STUDIO_SSH_ALIAS to ~/.ssh/config"
        else
            mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
            {
                printf '\n# Mac Studio - herdr remote server\n'
                printf 'Host %s\n' "$STUDIO_SSH_ALIAS"
                printf '  HostName %s\n' "$STUDIO_TAILNET_HOST"
                printf '  User %s\n' "$(id -un)"
            } >> "$HOME/.ssh/config"
            chmod 600 "$HOME/.ssh/config"
            ok "added Host $STUDIO_SSH_ALIAS to ~/.ssh/config"
        fi
    fi
    if grep -qs "herdr --remote $STUDIO_SSH_ALIAS" "$HOME/.config/zsh/local.zsh"; then
        skip "~/.config/zsh/local.zsh already has the herdr remote alias"
    else
        if is_dry_run; then
            would "append 'h' alias to ~/.config/zsh/local.zsh"
        else
            mkdir -p "$HOME/.config/zsh"
            {
                printf '\n# Mac Studio - herdr thin client\n'
                printf "alias h='herdr --remote %s'\n" "$STUDIO_SSH_ALIAS"
            } >> "$HOME/.config/zsh/local.zsh"
            ok "added 'h' alias to ~/.config/zsh/local.zsh"
        fi
    fi
    # Save the Studio as a herdr machine the same window can switch to. The
    # SSH Host alias above resolves the Tailnet name, so this must come after
    # it. Not fatal when unreachable (fresh laptop not yet on the tailnet):
    # the profile is simply left unsaved and the manual command is printed.
    if herdr machine list --json 2>/dev/null | grep -qs "\"target\": *\"$STUDIO_SSH_ALIAS\""; then
        skip "herdr machine '$STUDIO_SSH_ALIAS' already saved"
    elif is_dry_run; then
        would "save Mac Studio as a herdr machine (herdr machine add $STUDIO_SSH_ALIAS)"
    elif herdr machine add "$STUDIO_SSH_ALIAS" --label "Mac Studio"; then
        ok "saved herdr machine $STUDIO_SSH_ALIAS - shows next to Local in the sidebar"
    else
        run "could not save machine '$STUDIO_SSH_ALIAS' from here (tailnet connected?) - finish later with: herdr machine add $STUDIO_SSH_ALIAS"
    fi
}

# disable_spotlight_hotkey <hotkey-id>
disable_spotlight_hotkey() {
    defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys \
        -dict-add "$1" "<dict><key>enabled</key><false/></dict>"
}

# write_input_source_key <array> <index> <key> <value> - upsert one boolean
# in an input-source dict. Add fails when the key already exists.
write_input_source_key() {
    local target=":$1:$2:$3"
    "$PLIST_BUDDY" -c "Add $target bool $4" "$HITOOLBOX_PLIST" 2>/dev/null \
        || "$PLIST_BUDDY" -c "Set $target $4" "$HITOOLBOX_PLIST" 2>/dev/null \
        || run "could not write $target - set it in System Settings > Keyboard"
}

# disable_source_spellcheck <array> - turn the spell-check keys off in every
# entry of one HIToolbox input-source array.
disable_source_spellcheck() {
    local array_name="$1" entry_index key
    entry_count=$("$PLIST_BUDDY" -c "Print :$array_name" "$HITOOLBOX_PLIST" 2>/dev/null \
        | grep -c 'InputSourceKind') || return 0
    for ((entry_index = 0; entry_index < entry_count; entry_index++)); do
        for key in "${SPELL_CHECK_KEYS[@]}"; do
            write_input_source_key "$array_name" "$entry_index" "$key" false
        done
    done
}

# disable_input_source_spellcheck - since macOS Sonoma the "Correct spelling
# automatically" toggle lives per keyboard layout in com.apple.HIToolbox and
# overrides the global domain, so the -g default alone may not stick. Mirror
# the "off" state into every enabled and selected input source.
disable_input_source_spellcheck() {
    if [ ! -f "$HITOOLBOX_PLIST" ]; then
        run "HIToolbox plist not created yet - skipping per-input-source keys"
        return 0
    fi
    local array_name
    for array_name in AppleEnabledInputSources AppleSelectedInputSources; do
        disable_source_spellcheck "$array_name"
    done
}

configure_macos_defaults() {
    act "disable automatic spelling correction (global fallback domain)" sh -c '
        defaults write -g NSAutomaticSpellingCorrectionEnabled -bool false
        defaults write -g NSContinuousSpellCheckingEnabled -bool false'
    act "mirror spelling correction off into each input source" disable_input_source_spellcheck
    act "reload the preferences daemon" killall cfprefsd
    act "disable Spotlight hotkeys (cmd+space, cmd+alt+space)" sh -c '
        defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 64 "<dict><key>enabled</key><false/></dict>"
        defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 65 "<dict><key>enabled</key><false/></dict>"'
    activate_settings="/System/Library/PrivateFrameworks/SystemAdministration.framework/Versions/A/Resources/activateSettings"
    if [ -x "$activate_settings" ]; then
        act "reload system settings" "$activate_settings" -u
    fi
    ok "macOS defaults applied (relaunch apps or log out to see changes)"
}