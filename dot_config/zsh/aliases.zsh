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

# --- pi via la gateway Magpie du homelab (LXC 170, étape 2)
# pim : pi avec la clé `macbook` tirée d'Infisical (/homelab/magpie), jamais écrite sur disque ni passée en argument ;
# les autres clés du dossier (admin, page web) sont retirées avant de lancer pi. Extension : ~/.config/pi-vendor (fradser-pi-magpie).
pim() {
  infisical run --projectId=ce69a081-6aec-472d-9ee8-edbb7ed2b72e --env=main --path=/homelab/magpie --silent -- \
    sh -c 'MAGPIE_API_KEY="$MAGPIE_KEY_MACBOOK" exec env -u MAGPIE_KEY_MACBOOK -u MAGPIE_KEY_ADMIN -u MAGPIE_WEB_KEY \
      MAGPIE_BASE_URL=https://magpie.tail4df91e.ts.net/v1 pi "$@"' pim "$@"
}
