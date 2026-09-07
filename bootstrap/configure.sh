# configure.sh - post-install configuration: dotfiles and macOS defaults.

DOTFILES_REPO="walid-mos/dotfiles"

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

# --- herdr remote: Mac Studio as the always-on server ---
#
# Server = Mac Studio (headless, runs everything). Clients = MacBooks, which
# only run a thin `herdr --remote studio` client. The MagicDNS name must match
# the device hostname set by `tailscale up --hostname=...` on the server.
STUDIO_SSH_ALIAS="studio"
STUDIO_TAILNET_HOST="macstudio-de-walid.tail4df91e.ts.net"
STUDIO_TAILNET_DEVICE="macstudio-de-walid"

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
# Studio with an SSH Host alias and a one-key herdr attach. Idempotent,
# dry-run aware; appends to ~/.ssh/config and ~/.config/zsh/local.zsh.
configure_studio_client() {
    step "Mac Studio client (herdr remote attach)"
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
}

# disable_spotlight_hotkey <hotkey-id>
disable_spotlight_hotkey() {
    defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys \
        -dict-add "$1" "<dict><key>enabled</key><false/></dict>"
}

configure_macos_defaults() {
    act "disable automatic spelling correction" sh -c '
        defaults write -g NSAutomaticSpellingCorrectionEnabled -bool false
        defaults write -g NSContinuousSpellCheckingEnabled -bool false'
    act "disable Spotlight hotkeys (cmd+space, cmd+alt+space)" sh -c '
        defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 64 "<dict><key>enabled</key><false/></dict>"
        defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 65 "<dict><key>enabled</key><false/></dict>"'
    activate_settings="/System/Library/PrivateFrameworks/SystemAdministration.framework/Versions/A/Resources/activateSettings"
    if [ -x "$activate_settings" ]; then
        act "reload system settings" "$activate_settings" -u
    fi
    ok "macOS defaults applied (relaunch apps to see changes)"
}