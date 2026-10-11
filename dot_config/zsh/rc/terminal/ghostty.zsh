# Ghostty injects this itself only into shells it spawns directly, never into herdr panes.
[[ -n $GHOSTTY_RESOURCES_DIR && -r $GHOSTTY_RESOURCES_DIR/shell-integration/zsh/ghostty-integration ]] &&
  source $GHOSTTY_RESOURCES_DIR/shell-integration/zsh/ghostty-integration
