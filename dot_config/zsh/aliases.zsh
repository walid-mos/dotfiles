# Alias — aucun ne remplace une commande existante (ls, cat, cd restent intacts).
# Navigation : `z <dossier>` et `zi` viennent de zoxide (40-tools.zsh).

# --- Fichiers (eza, icônes Nerd Font + statut git)
alias ll='eza -l --icons=always --git --group-directories-first --time-style=relative'
alias la='ll -a'
alias lt='eza --tree --level=2 --icons=always --git-ignore'

# --- Outils
alias lg='lazygit'
alias ff='fastfetch'

# --- Shell
# szsh : efface l'écran et relance un zsh de login tout neuf (config rechargée, fastfetch compris)
szsh() { clear; exec zsh -l }
