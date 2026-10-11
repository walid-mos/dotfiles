autoload -Uz compinit
[[ -d $XDG_CACHE_HOME/zsh ]] || mkdir -p $XDG_CACHE_HOME/zsh
compinit -d $XDG_CACHE_HOME/zsh/zcompdump

zstyle ':completion:*' completer _complete _approximate
zstyle ':completion:*' matcher-list 'm:{a-zA-Z}={A-Za-z}' 'r:|[._-]=* r:|=*' 'l:|=* r:|=*'
zstyle ':completion:*' menu select
zstyle ':completion:*' group-name ''
zstyle ':completion:*' list-separator '·'
zstyle ':completion:*' use-cache on
zstyle ':completion:*' cache-path $XDG_CACHE_HOME/zsh/compcache
zstyle ':completion:*:descriptions' format '%F{yellow}-- %d --%f'
zstyle ':completion:*:warnings' format '%F{red}-- no matches --%f'
zstyle ':completion:*:-assign-*' tag-order '!parameters'
