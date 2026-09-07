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
    # Non-interactive by design: if a live file drifted from the repo
    # (e.g. config customized inside an app's UI), fail with instructions
    # instead of prompting mid-script or silently overwriting. Second-column
    # M/D in `chezmoi status` means the live file differs from the source;
    # a fresh machine only reports 'A' (new) entries, which is fine.
    drift=$(chezmoi status 2>/dev/null | awk '$2 ~ /[MD]/ {print $NF}')
    if [ -n "$drift" ]; then
        die "dotfiles drift detected between the repo and live files:
       $drift
       Review with:   chezmoi diff
       Absorb live edits into the repo:   chezmoi re-add <file>
       Then re-run this bootstrap."
    fi
    run "applying dotfiles"
    chezmoi apply --force
}

# configure_local_bin_path - user-local binaries (herdr, ...) live in
# ~/.local/bin, which no shell config puts on PATH by default. Idempotent,
# dry-run aware; appends one guarded export to ~/.zshrc.
configure_local_bin_path() {
    if grep -qs '.local/bin' "$HOME/.zshrc"; then
        skip "~/.zshrc already exports ~/.local/bin"
        return 0
    fi
    if is_dry_run; then
        would "append ~/.local/bin PATH export to ~/.zshrc"
        return 0
    fi
    {
        printf '\n# ~/.local/bin - user-local binaries (herdr, ...)\n'
        printf 'case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) export PATH="$HOME/.local/bin:$PATH" ;; esac\n'
    } >> "$HOME/.zshrc"
    ok "added ~/.local/bin to PATH in ~/.zshrc"
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
# dry-run aware; appends markers to ~/.ssh/config and ~/.zshrc.
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
    if grep -qs "herdr --remote $STUDIO_SSH_ALIAS" "$HOME/.zshrc"; then
        skip "~/.zshrc already has the herdr remote alias"
    else
        if is_dry_run; then
            would "append 'h' alias to ~/.zshrc"
        else
            {
                printf '\n# Mac Studio - herdr thin client\n'
                printf "alias h='herdr --remote %s'\n" "$STUDIO_SSH_ALIAS"
            } >> "$HOME/.zshrc"
            ok "added 'h' alias to ~/.zshrc"
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