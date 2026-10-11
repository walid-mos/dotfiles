HISTFILE=$XDG_STATE_HOME/zsh/history
HISTSIZE=50000
SAVEHIST=50000
[[ -d ${HISTFILE:h} ]] || mkdir -p ${HISTFILE:h}

setopt extended_history
setopt inc_append_history
setopt share_history
setopt hist_expire_dups_first
setopt hist_ignore_dups
setopt hist_ignore_all_dups
setopt hist_find_no_dups
setopt hist_ignore_space
setopt hist_save_no_dups
setopt hist_verify
setopt hist_no_store
