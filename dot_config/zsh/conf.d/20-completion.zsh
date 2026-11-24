# Complétion.

# Bundle antidote (re)généré quand plugins.txt change — même principe que `antidote load`,
# sans charger antidote à chaque démarrage. Fait ici, avant compinit : zsh-completions doit
# être dans fpath. Le bundle lui-même est sourcé après compinit (30-plugins : fzf-tab l'exige).
if [[ ! $ZSH_CACHE/plugins.zsh -nt $ZDOTDIR/plugins.txt ]]; then
  source /opt/homebrew/opt/antidote/share/antidote/antidote.zsh
  antidote bundle < "$ZDOTDIR/plugins.txt" >| "$ZSH_CACHE/plugins.zsh"
  zcompile "$ZSH_CACHE/plugins.zsh"
  for _f in "$ANTIDOTE_HOME"/**/*.zsh(N.); do zcompile "$_f"; done   # plugins compilés (.zwc)
  rm -f "$ZSH_CACHE/zcompdump"                              # nouvelles complétions → dump à refaire
fi
fpath=("$ANTIDOTE_HOME/zsh-users/zsh-completions/src" $fpath)   # site-functions brew : déjà là

autoload -Uz compinit
# Dump vérifié et reconstruit s'il manque ou a plus de 24 h ; sinon `compinit -C` (rapide).
_fresh=( "$ZSH_CACHE"/zcompdump(N.mh-24) )   # vide si le dump manque ou a plus de 24 h
if (( $#_fresh )); then
  compinit -C -d "$ZSH_CACHE/zcompdump"
else
  compinit -d "$ZSH_CACHE/zcompdump" && zcompile "$ZSH_CACHE/zcompdump"
fi
unset _f _fresh

zstyle ':completion:*' matcher-list 'm:{a-z}={A-Z}' 'r:|[._-]=* r:|=*'   # insensible à la casse
zstyle ':completion:*' list-colors ${(s.:.)LS_COLORS}
zstyle ':completion:*' menu no                                          # fzf-tab prend le relais
zstyle ':completion:*:descriptions' format '[%d]'
zstyle ':fzf-tab:*' switch-group '<' '>'
zstyle ':fzf-tab:complete:(cd|z):*' fzf-preview 'eza -1 --icons=always --color=always $realpath'
