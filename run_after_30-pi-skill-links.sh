#!/bin/sh
# Links the skills/ and extensions/ of the private repositories (~/.config/pi/pi-<name>, cloned by
# .chezmoiexternal.toml) to ~/.pi/agent/skills/<name> and ~/.pi/agent/extensions/<name>: Pi loads them like its own,
# and the public pi-agent repository names no other repository. Pi finds an extension directory through its index.ts.
# Each link is hidden from pi-agent by its .git/info/exclude (local to the machine, never pushed).
# Runs at every apply (not run_onchange), so it recreates a deleted link. Prints nothing when everything is in place.
set -u

PRIVATE="accor nextnode"   # private pi-<name> repositories, declared in .chezmoiexternal.toml
agent="$HOME/.pi/agent"
status=0

[ -d "$agent/.git" ] || { echo "pi-skill-links: $agent is not cloned yet, run chezmoi apply again"; exit 0; }
exclude="$agent/.git/info/exclude"

# link <kind> <name>: links ~/.config/pi/pi-<name>/<kind> to ~/.pi/agent/<kind>/<name>, if the repository has one.
link() {
  src="$HOME/.config/pi/pi-$2/$1"
  dst="$agent/$1/$2"
  [ -d "$src" ] || return 0
  if [ -e "$dst" ] && [ ! -L "$dst" ]; then
    echo "pi-skill-links: $dst exists and is not a link, left as is; move it away, then run chezmoi apply again"
    status=1; return 0
  fi
  mkdir -p "$agent/$1"
  [ "$(readlink "$dst" 2>/dev/null)" = "$src" ] || ln -sfn "$src" "$dst"
  # No trailing slash: to git, a link is not a directory.
  grep -qxF "/$1/$2" "$exclude" 2>/dev/null || echo "/$1/$2" >> "$exclude"
}

for name in $PRIVATE; do
  if [ ! -d "$HOME/.config/pi/pi-$name" ]; then
    echo "pi-skill-links: ~/.config/pi/pi-$name is missing (not cloned?), nothing linked for it"
    status=1; continue
  fi
  link skills "$name"
  link extensions "$name"
done
exit "$status"
