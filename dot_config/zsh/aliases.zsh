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
# pim : pi avec la clé de cette machine (`macbook` ou `mac-studio`) tirée d'Infisical (/homelab/magpie), jamais écrite sur disque
# ni passée en argument ; les autres clés du dossier (admin, page web, autres machines) sont retirées avant de lancer pi.
# Extension : ~/.config/pi-vendor (fradser-pi-magpie).
pim() {
  local var
  case "$(hostname -s)" in
    mac-studio)        var=MAGPIE_KEY_MAC_STUDIO ;;
    *)                 var=MAGPIE_KEY_MACBOOK ;;
  esac
  PIM_KEY_VAR=$var infisical run --projectId=ce69a081-6aec-472d-9ee8-edbb7ed2b72e --env=main --path=/homelab/magpie --silent -- \
    sh -c 'eval "MAGPIE_API_KEY=\"\${$PIM_KEY_VAR}\""; export MAGPIE_API_KEY
      exec env -u PIM_KEY_VAR -u MAGPIE_KEY_MACBOOK -u MAGPIE_KEY_MAC_STUDIO -u MAGPIE_KEY_ADMIN -u MAGPIE_WEB_KEY \
      MAGPIE_BASE_URL=https://magpie.tail4df91e.ts.net/v1 pi "$@"' pim "$@"
}
