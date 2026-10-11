export STARSHIP_CONFIG=$XDG_CONFIG_HOME/starship/starship.toml
(( $+commands[starship] )) && eval "$(starship init zsh)"
