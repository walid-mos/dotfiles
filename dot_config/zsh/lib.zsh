# Socle commun, chargé par .zprofile et .zshrc (une seule fois par shell).

ZSH_CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/zsh"
[[ -d $ZSH_CACHE ]] || mkdir -p "$ZSH_CACHE"

# _cached <nom> <programme> [args…] : exécute « programme args » une fois, garde sa sortie
# dans $ZSH_CACHE/<nom>.zsh (compilée en .zwc), puis la source. Régénéré quand le
# programme est plus récent que le cache (mise à jour brew…).
# <programme> : un nom de commande ou un chemin absolu.
_cached() {
  local cache="$ZSH_CACHE/$1.zsh" bin=${commands[$2]:-$2}
  [[ -x $bin ]] || return 0
  if [[ ! -s $cache || $bin -nt $cache ]]; then
    "${@:2}" >| "$cache" && zcompile "$cache"
  fi
  source "$cache"
}
