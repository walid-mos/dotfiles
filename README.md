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
| Repos à part | `~/.pi/agent`, `~/.config/pi/pi-vendor`, `pi-accor`, `pi-nextnode` (`.chezmoiexternal.toml`), loaded by pi as one package (`~/.config/pi/package.json`) |

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
- `dots -m "<type(scope): subject>" <file>...`: one commit holding only the named files (deployed files, or files
  of this repository such as a template), scanned by gitleaks and pushed; the rest stays uncommitted. It refuses a
  file that would stay out of step with the repository. Agents save every dotfile change this way (the `chezmoi`
  skill of `~/.pi/agent`); reposync then applies the push on the other Mac.
- Nouveau fichier : `chezmoi add <fichier>` (dots les signale).
- Récupérer les changements de l'autre machine : `chezmoi update`.
- `awsc <profile>`: logs an AWS SSO profile in and clicks Allow in its own headless Chromium; signing in to the
  identity provider stays manual (a window opens when needed). `--check` and `--headless` are for agents.
