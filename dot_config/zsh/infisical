# =============================================================================
# infisical — export the always-needed secrets from Infisical at shell load
# =============================================================================
# Sourced by ~/.zshenv for EVERY zsh invocation (interactive and not), so agent
# hooks and scripts see these exports too. No plaintext here: the universal-auth
# credentials live in ~/.config/zsh/secrets (values only), this file is logic
# only. The Infisical project is "core-vault", environment "Main" (slug "main").
#
# Why the explicit token flow: without --token the CLI resolves auth as
# "logged-in session" FIRST, and on macOS that probe goes to the keyring. In
# shells an sshd spawns there is no GUI session to unblock an access prompt,
# so the probe fails hard (security exit 36, errSecInteractionNotAllowed) and
# the whole fetch dies even though INFISICAL_UNIVERSAL_AUTH_* is exported.
# Machine identity must therefore be used EXPLICITLY: mint an access token
# with login --method=universal-auth (its default access-token TTL is 30 days)
# and pass it via --token. With --token set the CLI never touches the keyring,
# so the flow behaves identically in GUI terminals, ssh exec shells and hooks.
#
# Cost control: a refresh runs 2 HTTPS round-trips (~0.4 s), so a successful
# export set is cached in ~/.cache/zsh/infisical.env (0600) and reused for
# 300 seconds; shells started within the TTL skip the network entirely.
# =============================================================================
() {
  if [[ -z "$INFISICAL_UNIVERSAL_AUTH_CLIENT_ID" ]]; then
    print -u2 -- 'Infisical: INFISICAL_UNIVERSAL_AUTH_CLIENT_ID is missing; configure ~/.config/zsh/secrets.'
    return 1
  fi
  local infisical_command
  infisical_command=$(command -v infisical 2>/dev/null || echo /opt/homebrew/bin/infisical)
  local cache_file="${XDG_CACHE_HOME:-$HOME/.cache}/zsh/infisical.env"
  local ttl_seconds=300
  # Fresh cache (0600, user-only): source it and skip the network.
  local cache_age
  cache_age=$(( $(date +%s) - $(stat -f %m "$cache_file" 2>/dev/null || echo 0) ))
  if (( cache_age < ttl_seconds )); then
    setopt localoptions allexport
    eval "$(cat "$cache_file")"
    return
  fi
  local err_file access_token secret_exports
  err_file=$(mktemp -q) || return $?
  access_token="$("$infisical_command" login --method=universal-auth --silent --plain 2>"$err_file")" || {
    print -u2 -- "Infisical: universal-auth login failed: $(head -1 "$err_file")"
    rm -f "$err_file"
    return $?
  }
  secret_exports="$("$infisical_command" secrets get --token="$access_token" \
    --projectId=ce69a081-6aec-472d-9ee8-edbb7ed2b72e --env=main --path=/ --output dotenv --silent \
    TYPESAFE_API_KEY LINEAR_API_KEY SENTRY_AUTH_TOKEN OPENROUTER_MANAGEMENT_KEY INCO_API_KEY 2>"$err_file")" || {
    print -u2 -- "Infisical: secrets get failed: $(head -1 "$err_file")"
    rm -f "$err_file"
    return $?
  }
  rm -f "$err_file"
  setopt localoptions allexport
  eval "$secret_exports"
  # Persist for the next shells: atomic replace, user-only. Never fatal: a
  # failed cache write must not break the exports this shell just loaded.
  ( umask 077
    mkdir -p "${cache_file:h}"
    print -r -- "$secret_exports" > "$cache_file.tmp.$$" && mv -f "$cache_file.tmp.$$" "$cache_file" ) 2>/dev/null
}
