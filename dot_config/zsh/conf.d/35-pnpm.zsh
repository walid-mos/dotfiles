# =============================================================================
# pnpm
# =============================================================================
# macOS install.sh puts pnpm in ~/Library/pnpm (what bootstrap uses). Global
# binaries live in $PNPM_HOME/bin since pnpm >= 11, directly in $PNPM_HOME
# before - keep both on PATH.
# =============================================================================

export PNPM_HOME="$HOME/Library/pnpm"
for pnpm_bin_dir in "$PNPM_HOME/bin" "$PNPM_HOME"; do
  case ":$PATH:" in
    *":$pnpm_bin_dir:"*) ;;
    *) export PATH="$pnpm_bin_dir:$PATH" ;;
  esac
done
unset pnpm_bin_dir