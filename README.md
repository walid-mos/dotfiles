# dotfiles

Mes dotfiles macOS (Apple Silicon), gérés avec [chezmoi](https://chezmoi.io).
Thème : Rosé Pine Dawn (clair) / Kanagawa Wave (sombre), police GeistMono Nerd Font.

| Quoi | Où |
|---|---|
| Shell | zsh (antidote, starship, fzf-tab, atuin, zoxide) — `~/.config/zsh` |
| Éditeur | Neovim (lazy.nvim) — `~/.config/nvim` |
| Terminal | Herdr — settings, thèmes, layout `workspace` |
| Outils | git + delta, lazygit, btop, fastfetch, gh |
| Apps | Vicinae, Hex, Claude Code (`settings.json` sans `model`) |
| Paquets | `~/.config/homebrew/Brewfile`, installé automatiquement |
| Repos à part | `~/.pi/agent`, `~/.config/pi/pi-vendor`, `pi-accor`, `pi-nextnode` (`.chezmoiexternal.toml`); the skills of the last two are linked into `~/.pi/agent/skills/` by `run_after_30-pi-skill-links.sh` |

## Nouvelle machine

1. Créer la clé SSH GitHub (voir `~/.ssh/AGENTS.md` du repo) et l'ajouter à GitHub :
   `ssh-keygen -t ed25519 -f ~/.ssh/github -C "github@$(hostname -s)"`
2. Tout installer :
   ```sh
   sh -c "$(curl -fsLS get.chezmoi.io)" -- init --apply --source ~/.dotfiles walid-mos
   ```
   Installe Homebrew et le Brewfile, pose les fichiers, clone les repos pi.

## Au quotidien

- Le repo est dans `~/.dotfiles` ; les fichiers se modifient à leur place, normalement.
- `dots` : sauvegarde tout (re-add, Claude settings, scan gitleaks, commit, push).
  `dots -n` pour voir sans commiter.
- Nouveau fichier : `chezmoi add <fichier>` (dots les signale).
- Récupérer les changements de l'autre machine : `chezmoi update`.
