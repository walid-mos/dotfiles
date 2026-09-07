# =============================================================================
# Completion System
# =============================================================================

# Initialize completion engine (cache dir must exist before compinit)
autoload -Uz compinit
mkdir -p "${XDG_CACHE_HOME:-$HOME/.cache}/zsh"
compinit -d "${XDG_CACHE_HOME:-$HOME/.cache}/zsh/zcompdump"

# Completers
zstyle ':completion:*' completer _complete _approximate

# Case-insensitive and partial matching
zstyle ':completion:*' matcher-list 'm:{a-zA-Z}={A-Za-z}' 'r:|[._-]=* r:|=*' 'l:|=* r:|=*'

# Use menu selection (navigate with arrows)
zstyle ':completion:*' menu select

# Group results by category
zstyle ':completion:*' group-name ''
zstyle ':completion:*:descriptions' format '%F{yellow}-- %d --%f'
zstyle ':completion:*:warnings' format '%F{red}-- no matches --%f'

# Cache
zstyle ':completion:*' use-cache on
zstyle ':completion:*' cache-path "${XDG_CACHE_HOME:-$HOME/.cache}/zsh/compcache"

# Disable parameter assignment completion (prevents var=value ghost entries)
zstyle ':completion:*:-assign-*' tag-order '!parameters'

# Separator between completion and description
zstyle ':completion:*' list-separator '·'

# =============================================================================
# Fallback completer: parse --help for subcommands and flags
# =============================================================================
# Gives completion for tools that ship none: runs `<cmd> --help`, extracts
# subcommands and flags, and feeds them to the completion menu.

# Parser - runs in its own scope so locals don't leak into compadd
_help_only__parse() {
  setopt local_options extended_glob

  local help_output
  help_output=$("${(@)words[1,CURRENT-1]}" --help 2>&1)
  [[ -z "$help_output" ]] && help_output=$("${(@)words[1,CURRENT-1]}" help 2>&1)
  [[ -z "$help_output" ]] && return 1

  # Strip ANSI escape sequences (colors, bold, underline, etc.)
  help_output="${help_output//$'\e'\[[0-9;]#m/}"

  local in_commands_section=0 line trimmed flag_pair flag_desc flag flag_list cmd rest desc

  while IFS= read -r line; do
    [[ -z "${line##[[:space:]]#}" ]] && continue

    # Non-indented line -> section header
    if [[ "$line" != [[:space:]]* ]]; then
      [[ "${line:l}" == *command* || "${line:l}" == *subcommand* ]] && in_commands_section=1 || in_commands_section=0
      continue
    fi

    trimmed="${line##[[:space:]]##}"

    # Flags: lines starting with -
    if [[ "$trimmed" == -* ]]; then
      flag_pair="${trimmed%%[[:space:]][[:space:]]*}"
      flag_desc="${trimmed#${flag_pair}}"
      flag_desc="${flag_desc##[[:space:]]##}"
      for flag in ${(s:,:)flag_pair}; do
        flag="${flag##[[:space:]]##}"
        flag="${flag%%[[:space:]]*}"
        flag="${flag%%=*}"
        [[ "$flag" == -* ]] || continue
        [[ -n "$flag_desc" ]] && _ho_flags+=("${flag}:${flag_desc}") || _ho_flags+=("$flag")
      done
      continue
    fi

    # Subcommands: indented word inside a commands section
    if (( in_commands_section )); then
      cmd="${trimmed%%[[:space:]]*}"
      [[ "$cmd" == [[:alpha:]]* ]] || continue
      rest="${trimmed#$cmd}"
      desc="${rest##[[:space:]]##}"
      [[ "$desc" == "$rest" ]] && desc=""
      [[ -n "$desc" ]] && _ho_subcmds+=("$cmd:$desc") || _ho_subcmds+=("$cmd")
    fi
  done <<< "$help_output"
}

# Main completer - only has clean arrays in scope when compadd runs
_help_only() {
  setopt local_options extended_glob

  # Arrays populated by _help_only__parse (declared here so parse can write to them)
  local -a _ho_subcmds=() _ho_flags=()
  _help_only__parse || return 1

  # Nothing found
  (( ${#_ho_subcmds} + ${#_ho_flags} )) || return 1

  local ret=1
  (( ${#_ho_subcmds} )) && { _describe -t commands 'command' _ho_subcmds && ret=0; }
  (( ${#_ho_flags} ))   && { _describe -t options 'option' _ho_flags && ret=0; }
  return $ret
}
compdef _help_only -default-