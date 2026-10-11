# Sourced by .zshenv for every shell, then again by .zprofile: /etc/zprofile's path_helper reorders PATH in between.
() {
  local -a leading=(
    $HOME/.config/shims
    $PNPM_HOME/bin
    $HOMEBREW_PREFIX/bin
    $HOMEBREW_PREFIX/sbin
    $HOME/.cargo/bin
  )
  local -a trailing=(
    $HOME/.ascii/bin
    $HOME/.local/bin
  )
  path=(${^leading}(N-/) ${${path:|leading}:|trailing} ${^trailing}(N-/))
}
