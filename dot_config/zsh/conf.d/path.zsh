# ~/.local/bin - user-local binaries (herdr, ...). No tool installs here by
# default, but the herdr installer targets this directory explicitly.
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac
