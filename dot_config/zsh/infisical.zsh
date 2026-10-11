# Sourced by .zshenv for every shell: hooks and scripts need these keys too.
autoload -Uz infisical-refresh
() {
  emulate -L zsh
  if [[ -z $INFISICAL_UNIVERSAL_AUTH_CLIENT_ID ]]; then
    [[ -o interactive ]] && print -u2 'infisical: INFISICAL_UNIVERSAL_AUTH_CLIENT_ID is missing from ~/.config/zsh/secrets'
    return 1
  fi
  zmodload -F zsh/stat b:zstat
  zmodload zsh/datetime
  local cache_file=$XDG_CACHE_HOME/zsh/infisical.env
  local -i cache_ttl_seconds=3600
  local -a cache_mtime
  if ! zstat -A cache_mtime +mtime $cache_file 2>/dev/null; then
    infisical-refresh || return
    cache_mtime=($EPOCHSECONDS)
  fi
  [[ -r $cache_file ]] || return 1
  setopt allexport
  source $cache_file
  unsetopt allexport
  (( EPOCHSECONDS - cache_mtime[1] < cache_ttl_seconds )) && return
  # A stale cache still serves this shell; the refresh runs detached so no shell ever waits on the network.
  setopt no_monitor no_notify
  infisical-refresh > /dev/null 2> $cache_file.log &!
}
