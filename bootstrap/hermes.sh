# hermes.sh - Hermes Agent personal-AI setup (laptop profile only).
#
# Two planes, mirroring the repo split:
#   declarative  -> chezmoi source dot_hermes/ (~/.hermes code assets + bot
#                   profiles) - applied by apply_dotfiles BEFORE this module
#   imperative   -> this module (agent runtime install, /etc/hermes global
#                   layer with root-protected permissions, profile registry,
#                   launchd services)
#
# Node policy: Hermes ships a self-managed Node v26 under ~/.hermes/node (its
# browser toolset builds against it; `hermes update` maintains it). It must
# never shadow the user's own toolchain: HERMES_NODE_SKIP_LINKS=1 in
# ~/.hermes/.env plus the symlink hygiene below keeps ~/.local/bin clean.
# Verified 2026-09: the CLI installer itself does not honor that env var, and
# installs are non-idempotent for links, hence we re-clean on every pass.

# runtime swap used on THIS machine (2026-09, manual one-off; the repo-wide
# reset-day default remains hermes-managed python via the official installer):
#   brew install python@3.11
#   UV_PYTHON_PREFERENCE=only-system UV_PYTHON_DOWNLOADS=never \
#     ~/.hermes/bin/uv venv --python /opt/homebrew/opt/python@3.11/bin/python3.11 \
#     ~/.hermes/hermes-agent/venv
#   cd ~/.hermes/hermes-agent && UV_PROJECT_ENVIRONMENT="$PWD/venv" \
#     ~/.hermes/bin/uv sync --frozen --all-extras --no-extra matrix   # python-olm
#     (matrix extra fails to build against brew framework python; not used here)
#   ~/.hermes/bin/uv tool upgrade browser-use --python <brewpython>  # re-home tools
#   rm -rf ~/.local/share/uv/python   # no hermes-managed python at all
# Verifies: hermes -z, HERMES_HOME=profiles/comptable hermes -z, gateway status.

# Bots to register. Each must have a full payload in
# dot_hermes/profiles/<bot>/ (config.yaml, SOUL.md, ...).
HERMES_BOTS=(comptable)

# Remove ~/.local/bin symlinks that shadow the user's own toolchain with
# hermes-managed node or uv-managed python. Idempotent; safe to re-run.
hermes_runtime_hygiene() {
    local f target
    for f in node npm npx python python3.11; do
        target=$(readlink "$HOME/.local/bin/$f" 2>/dev/null) || target=""
        case "$target" in
            *"/.hermes/node/"*|*"/uv/python/"*|"python3.11")
                if is_dry_run; then
                    would "unlink shadowing ~/.local/bin/$f"
                else
                    rm -f "$HOME/.local/bin/$f"
                    ok "unlinked shadowing ~/.local/bin/$f"
                fi
                ;;
        esac
    done
}

setup_hermes() {
    step "Hermes Agent (personal AI)"
    local hermes_src
    hermes_src=$(chezmoi source-path)/bootstrap/hermes

    # 1. Install the agent runtime if missing (non-interactive, CLI-only).
    #    The Desktop app (brew cask hermes-desktop) reuses the same ~/.hermes.
    if ! command_exists hermes; then
        if is_dry_run; then
            would "install Hermes agent runtime (curl install.sh --skip-setup, ~3-5 min)"
            would "seed HERMES_NODE_SKIP_LINKS=1 into ~/.hermes/.env"
        else
            if curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --skip-setup; then
                ok "Hermes agent runtime installed (~/.hermes/hermes-agent, launcher ~/.local/bin/hermes)"
            else
                run "CLI install failed - fallback: brew install --cask hermes-desktop (CLI appears on first app launch), then re-run bootstrap"
                return 0
            fi
        fi
    fi

    # 2. Runtime hygiene: hermes-managed node must never shadow the user
    #    toolchain (also if a runtime heal re-installs the bundle).
    if [ -f "$HOME/.hermes/.env" ] && ! grep -q '^HERMES_NODE_SKIP_LINKS=' "$HOME/.hermes/.env"; then
        if is_dry_run; then
            would "seed HERMES_NODE_SKIP_LINKS=1 into ~/.hermes/.env"
        else
            printf '\n# never shadow the user toolchain with hermes-managed node\nHERMES_NODE_SKIP_LINKS=1\n' \
                >> "$HOME/.hermes/.env"
        fi
    fi
    hermes_runtime_hygiene

    # 3. Global managed layer for every agent home (root-protected: the point
    #    is that profile configs cannot override these pins; also the env layer
    #    GUI apps and launchd gateways see without any shell).
    if is_dry_run; then
        would "install /etc/hermes/config.yaml from bootstrap/hermes/managed-config.yaml"
    elif sudo -v 2>/dev/null; then
        sudo mkdir -p /etc/hermes
        sudo cp "$hermes_src/managed-config.yaml" /etc/hermes/config.yaml
        sudo chmod 0755 /etc/hermes
        sudo chmod 0644 /etc/hermes/config.yaml
        ok "global pinned layer installed in /etc/hermes"
    else
        run "no root access right now - finish later by hand:"
        printf '      sudo mkdir -p /etc/hermes && sudo cp "%s/managed-config.yaml" /etc/hermes/config.yaml && sudo chmod 0755 /etc/hermes && sudo chmod 0644 /etc/hermes/config.yaml\n' "$hermes_src"
    fi

    # 4. Shared provider keys. Lifted from the live root home .env (never
    #    through git); skipped silently when no key file exists yet.
    #    Bot-local .env files are one-time imports from the backup volume,
    #    handled per-bot in the registry loop below.
    local env_src="$HOME/.hermes/.env"
    if [ ! -f "$env_src" ]; then
        skip "no $env_src yet - import it from your backup volume, then re-run"
    elif grep -qE '^[A-Za-z0-9_]+_(API_KEY|TOKEN)=' "$env_src"; then
        if is_dry_run; then
            would "lift *_API_KEY/*_TOKEN lines from $env_src into /etc/hermes/.env"
        elif sudo -v 2>/dev/null; then
            grep -E '^[A-Za-z0-9_]+_(API_KEY|TOKEN)=' "$env_src" \
                | sudo tee /etc/hermes/.env >/dev/null
            sudo chmod 0644 /etc/hermes/.env
            ok "shared provider keys installed in /etc/hermes/.env"
        else
            run "no root access right now - finish later: sudo tee /etc/hermes/.env < <(grep -E '^[A-Za-z0-9_]+_(API_KEY|TOKEN)=' $env_src)"
        fi
    else
        skip "$env_src has no shared provider keys"
    fi

    # 5. Bot registry + wrapper aliases (payload files were applied by chezmoi).
    local bot
    for bot in "${HERMES_BOTS[@]}"; do
        if [ ! -d "$HOME/.hermes/profiles/$bot" ]; then
            run "bot '$bot' payload not found in dot_hermes/profiles - skipped"
            continue
        fi
        if is_dry_run; then
            would "register bot '$bot' (hermes profile create + alias wrapper)"
            continue
        fi
        if hermes profile show "$bot" >/dev/null 2>&1; then
            ok "bot '$bot' already registered"
        elif hermes profile create "$bot" >/dev/null 2>&1; then
            ok "bot '$bot' registered (config/SOUL/cron come from chezmoi)"
        else
            run "could not register '$bot' - finish later: hermes profile create $bot"
        fi
        hermes profile alias "$bot" --name "$bot" >/dev/null 2>&1 \
            || ok "wrapper '$bot' already exists"
        # The description itself is declarative: dot_hermes/profiles/<bot>/profile.yaml
        # ships 'description:' + 'description_auto: false', which hermes reads from
        # the profile home. If a hermes version ignores an existing file, set it
        # once by hand: hermes profile describe <bot> --text "..."
        if [ -f "$HOME/.hermes/profiles/$bot/.env" ]; then
            ok "bot '$bot' .env present (provider keys)"
        else
            run "bot '$bot' has no .env - one-time secrets import (from your backup volume):"
            printf '      cp "<VOL>/backup/hermes/.hermes/profiles/%s/.env" "$HOME/.hermes/profiles/%s/.env" && chmod 600 "$HOME/.hermes/profiles/%s/.env"\n' "$bot" "$bot" "$bot"
        fi
    done

    # 6. Blank-slate skills posture (bundled catalog stays unseeded).
    if is_dry_run; then
        would "opt the root home out of the bundled skill catalog"
    else
        act "no bundled skills on the root home" hermes skills opt-out
    fi

    # 7. LaunchAgent: headless Chrome agent (CDP 9223) for browser toolsets.
    act "install com.walid.chrome-agent LaunchAgent" \
        cp "$hermes_src/com.walid.chrome-agent.plist" \
           "$HOME/Library/LaunchAgents/com.walid.chrome-agent.plist"
    act "create Chrome agent data dir" \
        mkdir -p "$HOME/Library/Application Support/Google/Chrome-Agent"
    ok "Chrome agent installed (RunAtLoad=false — start on demand:
        launchctl kickstart gui/\$(id -u)/com.walid.chrome-agent)"

    # 8. Verify.
    if is_dry_run; then
        would "run hermes doctor + hermes profile list"
    else
        hermes doctor || true
        hermes profile list || true
    fi
}
