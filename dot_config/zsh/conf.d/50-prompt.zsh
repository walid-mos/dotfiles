# Prompt starship « D4 » : icônes, séparateurs en point, ligne vide avant chaque prompt.
export STARSHIP_CONFIG="$ZDOTDIR/starship.toml"
_cached init-starship starship init zsh --print-full-init
RPROMPT=''   # starship.toml n'a pas de partie droite : évite un 2e appel starship par prompt
