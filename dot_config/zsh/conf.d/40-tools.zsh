# Outils CLI. Règle « ANSI d'abord » : chaque outil utilise les 16 couleurs du terminal,
# donc suit le thème Herdr (Rosé Pine Dawn le jour, Kanagawa Wave la nuit) sans réglage.

# fzf : ctrl-t (fichiers), alt-c (dossiers). Schéma 16 couleurs + quelques accents.
export FZF_DEFAULT_COMMAND='fd --type f --hidden --exclude .git'
export FZF_CTRL_T_COMMAND=$FZF_DEFAULT_COMMAND
export FZF_ALT_C_COMMAND='fd --type d --hidden --exclude .git'
export FZF_DEFAULT_OPTS="--layout=reverse --height=50% --border=rounded --info=inline-right \
--prompt='  ' --pointer='▌' --marker='▏' --separator='─' \
--color=16,hl:5,hl+:5:bold,info:8,prompt:4,pointer:5,marker:2,spinner:6,header:8,border:8,separator:8,gutter:-1"
export FZF_CTRL_T_OPTS="--preview 'bat --color=always --style=numbers --line-range=:200 {}'"
export FZF_ALT_C_OPTS="--preview 'eza -1 --icons=always --color=always {}'"
# Seulement dans un vrai terminal : sans terminal (zsh -i -c en tâche de fond), son init
# tente de réactiver l'éditeur de ligne et affiche « can't change option: zle ».
[[ -t 0 ]] && _cached init-fzf fzf --zsh

# zoxide : `z dossier` (saut intelligent), `zi` (choix avec fzf). `cd` reste intact.
_cached init-zoxide zoxide init zsh

# atuin : historique enrichi sur ctrl-r (chargé après fzf, il prend ctrl-r).
# La flèche du haut garde son comportement normal.
_cached init-atuin atuin init zsh --disable-up-arrow
# atuin s'ajoute aux suggestions grisées (une recherche atuin par frappe) : on garde
# l'historique zsh + la complétion, plus légers.
ZSH_AUTOSUGGEST_STRATEGY=(history completion)

# bat et delta : thème « ansi » → couleurs du terminal. bat sert aussi de pager pour man.
export BAT_THEME=ansi
export MANPAGER="sh -c 'col -bx | bat -l man -p'"
export MANROFFOPT='-c'

# lazygit : config dans ~/.config (par défaut sur macOS : ~/Library/Application Support).
export LG_CONFIG_FILE="$HOME/.config/lazygit/config.yml"
