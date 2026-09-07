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
    run "applying dotfiles"
    chezmoi apply
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