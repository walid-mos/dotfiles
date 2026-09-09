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

# --- herdr remote: Mac Studio <-> laptops mutual herdr machines ---
#
# Server = Mac Studio (headless, runs everything). Clients = MacBooks. Both
# ends keep a saved profile of the other (herdr 0.9+ Machines), so each
# sidebar shows Local + the peer and either side can view the other without
# ssh gymnastics. The dance runs from the laptop bootstrap: it installs the
# laptop's ssh key on the Studio, saves the Studio as a machine locally, then
# authorizes the Studio's key back and tells the Studio (over ssh) to save
# this laptop. The target is the MagicDNS short name: the tailnet resolver
# answers short names directly (verified live: dig @100.100.100.100
# mac-studio -> 100.95.191.41, plus a full ssh handshake over the short
# name), so no ~/.ssh/config alias is needed - the profile carries user +
# host verbatim.
STUDIO_TAILNET_DEVICE="mac-studio"
STUDIO_SSH_USER="walid-mos"
STUDIO_SSH_TARGET="${STUDIO_SSH_USER}@${STUDIO_TAILNET_DEVICE}"

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

# ssh_batch - non-interactive ssh that accepts new host keys and gives up
# fast; probes and Studio-driving only.
ssh_batch() {
    ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new "$@"
}

# authorize_ssh_key <pubkey-line> - add one public key to this Mac's
# authorized_keys (mode-guarded, duplicate-safe).
authorize_ssh_key() {
    mkdir -p "$HOME/.ssh"
    chmod 700 "$HOME/.ssh"
    touch "$HOME/.ssh/authorized_keys"
    chmod 600 "$HOME/.ssh/authorized_keys"
    grep -qsxF "$1" "$HOME/.ssh/authorized_keys" || printf '%s\n' "$1" >> "$HOME/.ssh/authorized_keys"
}

# discover_laptop_magicdns - short MagicDNS name of this Mac from the
# Tailscale CLI (GUI app or cask); failure when tailscale is missing or
# signed out. Used as the Studio's pointer back to this Mac.
discover_laptop_magicdns() {
    local ts_client dns short
    if command_exists tailscale; then
        ts_client="tailscale"
    elif [ -x "/Applications/Tailscale.app/Contents/MacOS/Tailscale" ]; then
        ts_client="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
    else
        return 1
    fi
    dns=$("$ts_client" status --json 2>/dev/null | grep -o '"DNSName": *"[^"]*"' | head -1) || return 1
    dns=${dns#*\"}
    dns=${dns%\"}
    short=${dns%%.*}
    [ -n "$short" ] || return 1
    printf '%s\n' "$short"
}

# configure_studio_client - laptop profile only: pair this Mac with the
# Studio for herdr (0.9+ Machines) in both directions:
#
#   1. key-based ssh laptop -> Studio (ed25519 keypair generated on the
#      fly, installed with ssh-copy-id - the Studio password is asked once)
#   2. laptop side: save the Studio as a machine (sidebar shows Local +
#      Mac Studio) plus the 'h' manual-attach alias
#   3. reverse: authorize the Studio's public key on this Mac, then drive
#      'herdr machine add <this-mac>' on the Studio over ssh
#
# Each direction is idempotent; an unreachable or signed-out tailnet prints
# finish-later commands instead of failing the bootstrap. Dry-run aware;
# appends to ~/.config/zsh/local.zsh.
configure_studio_client() {
    step "Mac Studio <-> this Mac (herdr machines)"

    # A fresh Mac needs a keypair before anything can talk to the Studio.
    if [ -f "$HOME/.ssh/id_ed25519.pub" ]; then
        skip "~/.ssh/id_ed25519 already exists"
    elif is_dry_run; then
        would "generate ~/.ssh/id_ed25519 (ed25519, no passphrase)"
    else
        mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
        act "generate ~/.ssh/id_ed25519" ssh-keygen -t ed25519 -N "" \
            -f "$HOME/.ssh/id_ed25519" -C "${USER:-$(id -un)}@$(hostname -s)"
    fi

    # Seeding the key on the Studio first is what makes both herdr machine
    # adds (laptop -> Studio and Studio -> laptop) passwordless.
    if ssh_batch "$STUDIO_SSH_TARGET" true 2>/dev/null; then
        skip "key-based ssh to $STUDIO_SSH_TARGET already works"
    elif is_dry_run; then
        would "install this Mac's key on the Studio (ssh-copy-id, password asked once)"
    elif ssh-copy-id -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new "$STUDIO_SSH_TARGET" \
        && ssh_batch "$STUDIO_SSH_TARGET" true 2>/dev/null; then
        ok "key installed - the Studio accepts this Mac without a password"
    else
        run "ssh-copy-id failed (tailnet up? Studio reachable?) - finish later with:"
        printf '      ssh-copy-id -o StrictHostKeyChecking=accept-new %s\n' "$STUDIO_SSH_TARGET"
        return 0
    fi

    if grep -qs "herdr --remote $STUDIO_SSH_TARGET" "$HOME/.config/zsh/local.zsh"; then
        skip "~/.config/zsh/local.zsh already has the herdr remote alias"
    else
        if is_dry_run; then
            would "append 'h' alias to ~/.config/zsh/local.zsh"
        else
            mkdir -p "$HOME/.config/zsh"
            {
                printf '\n# Mac Studio - herdr manual attach (fallback for Attention states)\n'
                printf "alias h='herdr --remote %s'\n" "$STUDIO_SSH_TARGET"
            } >> "$HOME/.config/zsh/local.zsh"
            ok "added 'h' alias to ~/.config/zsh/local.zsh"
        fi
    fi
    # Save the Studio as a herdr machine the same window can switch to. Not
    # fatal when unreachable (fresh laptop not yet signed into the tailnet):
    # the profile stays unsaved and the manual command is printed.
    if herdr machine list --json 2>/dev/null | grep -qs "\"target\": *\"$STUDIO_SSH_TARGET\""; then
        skip "herdr machine '$STUDIO_SSH_TARGET' already saved"
    elif is_dry_run; then
        would "save Mac Studio as a herdr machine (herdr machine add $STUDIO_SSH_TARGET)"
    elif herdr machine add "$STUDIO_SSH_TARGET" --label "Mac Studio"; then
        ok "saved herdr machine $STUDIO_SSH_TARGET - shows next to Local in the sidebar"
    else
        run "could not save machine '$STUDIO_SSH_TARGET' from here (tailnet connected?) - finish later with: herdr machine add $STUDIO_SSH_TARGET"
    fi

    # Reverse direction - the Studio saves this Mac: its public key lands in
    # this Mac's authorized_keys first, then the add runs over ssh on the
    # Studio itself and applies to open clients automatically.
    if is_dry_run; then
        would "authorize the Studio's key in ~/.ssh/authorized_keys"
        would "save this Mac as a herdr machine on the Studio (over ssh)"
        return 0
    fi
    local studio_pubkey laptop_short laptop_target laptop_label
    studio_pubkey=$(ssh_batch "$STUDIO_SSH_TARGET" cat "$HOME/.ssh/id_ed25519.pub" 2>/dev/null)
    if [ -n "$studio_pubkey" ] && authorize_ssh_key "$studio_pubkey"; then
        ok "authorized the Studio's key on this Mac - it can reach back over ssh"
    else
        run "could not fetch the Studio's public key - run later:"
        printf '      ssh %s cat ~/.ssh/id_ed25519.pub >> ~/.ssh/authorized_keys\n' "$STUDIO_SSH_TARGET"
    fi

    if laptop_short=$(discover_laptop_magicdns); then
        laptop_target="$STUDIO_SSH_USER@$laptop_short"
        laptop_label=$(scutil --get ComputerName 2>/dev/null | tr -d "'")
        [ -n "$laptop_label" ] || laptop_label=$(hostname -s)
        if ssh_batch "$STUDIO_SSH_TARGET" "PATH=\"\$HOME/.local/bin:\$PATH\" herdr machine list --json" \
            | grep -qs "\"target\": *\"$laptop_target\""; then
            skip "herdr machine '$laptop_target' already saved on the Studio"
        elif ssh_batch "$STUDIO_SSH_TARGET" "PATH=\"\$HOME/.local/bin:\$PATH\" herdr machine add $laptop_target --label '$laptop_label'"; then
            ok "saved herdr machine $laptop_target on the Studio - both sidebars now show both machines"
        else
            run "could not save this Mac on the Studio - finish later on the Studio with:"
            printf '      herdr machine add %s --label "%s"\n' "$laptop_target" "$laptop_label"
        fi
    else
        run "could not discover this Mac's MagicDNS name (tailscale signed in?) - finish later on the Studio with:"
        printf '      herdr machine add %s@<magicdns-name> --label "<this Mac>"\n' "$STUDIO_SSH_USER"
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