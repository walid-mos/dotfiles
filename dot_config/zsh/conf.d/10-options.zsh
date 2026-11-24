# Historique et options du shell.
HISTFILE="$ZDOTDIR/.zsh_history"
HISTSIZE=50000
SAVEHIST=50000
setopt EXTENDED_HISTORY HIST_IGNORE_ALL_DUPS HIST_IGNORE_SPACE HIST_REDUCE_BLANKS SHARE_HISTORY
setopt AUTO_CD AUTO_PUSHD PUSHD_IGNORE_DUPS INTERACTIVE_COMMENTS NO_BEEP

# Plugins antidote : clonés sous des noms lisibles (zsh-users/zsh-completions…).
# 20-completion.zsh compte sur ce nom pour trouver zsh-completions.
export ANTIDOTE_HOME="$ZSH_CACHE/antidote"
zstyle ':antidote:bundle' use-friendly-names on
