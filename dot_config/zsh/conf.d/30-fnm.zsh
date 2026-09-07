# =============================================================================
# Node Version Manager (fnm)
# =============================================================================

export FNM_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/fnm"
export PATH="$FNM_DIR:$PATH"

if command -v fnm &>/dev/null && [[ -o interactive ]]; then
  eval "$(fnm env --use-on-cd)"
fi