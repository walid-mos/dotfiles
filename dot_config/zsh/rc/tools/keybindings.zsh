autoload -Uz history-search-end
zle -N history-beginning-search-backward-end history-search-end
zle -N history-beginning-search-forward-end history-search-end
bindkey '^[[A' history-beginning-search-backward-end
bindkey '^[OA' history-beginning-search-backward-end
bindkey '^[[B' history-beginning-search-forward-end
bindkey '^[OB' history-beginning-search-forward-end

insert-newline() {
  LBUFFER+=$'\n'
}
zle -N insert-newline
bindkey -M emacs $'\e[27;2;13~' insert-newline
bindkey -M emacs $'\e[13;2u' insert-newline
bindkey -M viins $'\e[27;2;13~' insert-newline
bindkey -M viins $'\e[13;2u' insert-newline
