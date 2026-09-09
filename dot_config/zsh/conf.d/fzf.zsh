# =============================================================================
# fzf - shell integration
# =============================================================================
# Provides Ctrl-R (history search), Ctrl-T (file insert), Alt-C (cd) key
# bindings and **<TAB> fuzzy completion. External scripts only need the fzf
# binary; this is quality of life for the interactive shell.
# Loads after completion.zsh (alphabetical order) so compinit already ran.
# =============================================================================

if command -v fzf >/dev/null 2>&1; then
  eval "$(fzf --zsh)"
fi