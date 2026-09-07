#!/bin/zsh
# profiles.sh - profile composition and entry point. Run via the top-level
# bootstrap.sh downloader, which fetches this module and its dependencies.

set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$script_dir/lib.sh"
. "$script_dir/packages.sh"
. "$script_dir/configure.sh"

# Profile composition - add a new step by calling the installer or
# configuration function in the right profile.
setup_common() {
    step "Homebrew"
    ensure_sudo
    install_homebrew
    ensure_brew_taps
    install_brew_list formula "${BREW_FORMULAS[@]}"
    install_brew_list cask "${BREW_CASKS[@]}"

    step "Toolchain"
    install_pnpm
    install_node
    install_pi
    install_herdr

    step "Dotfiles"
    apply_dotfiles
    configure_zsh_secrets

    step "macOS defaults"
    configure_macos_defaults
}

setup_laptop() {
    setup_common
    step "Fonts"
    install_brew_list cask "${LAPTOP_CASKS[@]}"
    install_nerd_fonts
    configure_studio_client
}

setup_server() {
    setup_common
    install_tailscale_daemon
    configure_headless_server
    configure_server_reminders
}

main() {
    profile="laptop"
    for arg in "$@"; do
        case "$arg" in
            --dry-run) DRY_RUN=1 ;;
            laptop | server) profile="$arg" ;;
            *) die "Unknown argument '$arg' (expected: --dry-run, laptop or server)" ;;
        esac
    done
    require_interactive_terminal
    if is_dry_run; then
        printf '\n\033[1;33mDRY RUN\033[0m - nothing will be modified (%s profile)\n' "$profile"
    fi
    if [ "$profile" = laptop ]; then
        setup_laptop
    else
        setup_server
    fi
    printf '\n\033[1;32m\xe2\x9c\x94\033[0m Setup complete (%s profile, %ss)\n' "$profile" "$SECONDS"
}

main "$@"