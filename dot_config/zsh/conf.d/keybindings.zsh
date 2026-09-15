# Insert a literal newline without accepting the command line.
insert-newline() {
  LBUFFER+=$'\n'
}
zle -N insert-newline

# Ghostty Shift+Enter: modifyOtherKeys and Kitty keyboard encodings.
for keymap in emacs viins; do
  bindkey -M "$keymap" $'\e[27;2;13~' insert-newline
  bindkey -M "$keymap" $'\e[13;2u' insert-newline
done
unset keymap
