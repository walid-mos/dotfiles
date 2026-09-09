#!/bin/zsh
# Studio-only development infrastructure. Source code ships inside the dotfiles
# repository; runtime state and CA private keys never enter chezmoi.

configure_studio_workspaces() {
    step "Studio workspaces (Apple Container)"
    local source_root workspace_source
    source_root=$(chezmoi source-path)
    workspace_source="$source_root/bootstrap/workspace"
    if is_dry_run; then
        would "build the development image, install wt, private DNS/HTTPS and the official Pi integration"
        return 0
    fi
    [[ -f "$workspace_source/src/cli.ts" ]] || die "Workspace sources are missing from the dotfiles checkout"
    act "build/reuse the Linux development image" node "$workspace_source/scripts/build-image.mjs"
    act "install the official Pi/Herdr integration" herdr integration install pi
    act "install private Studio gateway and CLI" python3 "$workspace_source/scripts/install-host.py" --admin sudo
}
