_help_completer_flag_line() {
  local line=$1 flag_pair flag_description flag
  flag_pair=${line%%[[:space:]][[:space:]]*}
  flag_description=${${line#$flag_pair}##[[:space:]]##}
  for flag in ${(s:,:)flag_pair}; do
    flag=${${${flag##[[:space:]]##}%%[[:space:]]*}%%=*}
    [[ $flag == -* ]] || continue
    help_flags+=($flag${flag_description:+:$flag_description})
  done
}

_help_completer_command_line() {
  local line=$1 name=${1%%[[:space:]]*} description
  [[ $name == [[:alpha:]]* ]] || return
  description=${${line#$name}##[[:space:]]##}
  help_subcommands+=($name${description:+:$description})
}

_help_completer_parse() {
  local help_output line trimmed
  local -i in_commands_section=0
  help_output=$("${(@)words[1,CURRENT-1]}" --help 2>&1 < /dev/null)
  [[ -n $help_output ]] || help_output=$("${(@)words[1,CURRENT-1]}" help 2>&1 < /dev/null)
  help_output=${help_output//$'\e'\[[0-9;]#m/}
  for line in "${(@f)help_output}"; do
    [[ -z ${line##[[:space:]]#} ]] && continue
    if [[ $line != [[:space:]]* ]]; then
      [[ ${line:l} == *command* ]] && in_commands_section=1 || in_commands_section=0
      continue
    fi
    trimmed=${line##[[:space:]]##}
    if [[ $trimmed == -* ]]; then
      _help_completer_flag_line "$trimmed"
    elif (( in_commands_section )); then
      _help_completer_command_line "$trimmed"
    fi
  done
}

# Only a bare command name gets probed with --help: Tab must never execute ./script or node_modules/.bin/x.
_help_completer() {
  local -a help_subcommands help_flags
  local -i found=1
  [[ $words[1] == */* ]] || _help_completer_parse
  (( $#help_subcommands )) && _describe -t commands 'command' help_subcommands && found=0
  (( $#help_flags )) && _describe -t options 'option' help_flags && found=0
  _default && found=0
  return found
}

compdef _help_completer -default-
