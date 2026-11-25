#!/bin/sh
# Links the skills of the private repositories (~/.config/pi/pi-<name>/skills, cloned by .chezmoiexternal.toml) to
# ~/.pi/agent/skills/<name>: Pi loads them like its own, and the public pi-agent repository names no other repository.
# The link is hidden from pi-agent by its .git/info/exclude (local to the machine, never pushed).
# Runs at every apply (not run_onchange), so it recreates a deleted link. Prints nothing when everything is in place.
set -u

PRIVATE="accor nextnode"   # private pi-<name> repositories, declared in .chezmoiexternal.toml
agent="$HOME/.pi/agent"
status=0

[ -d "$agent/.git" ] || { echo "pi-skill-links: $agent is not cloned yet, run chezmoi apply again"; exit 0; }
exclude="$agent/.git/info/exclude"

for name in $PRIVATE; do
  src="$HOME/.config/pi/pi-$name/skills"
  dst="$agent/skills/$name"
  if [ ! -d "$src" ]; then
    echo "pi-skill-links: $src is missing (pi-$name not cloned?), $dst not linked"
    status=1; continue
  fi
  if [ -e "$dst" ] && [ ! -L "$dst" ]; then
    echo "pi-skill-links: $dst exists and is not a link, left as is; move it away, then run chezmoi apply again"
    status=1; continue
  fi
  [ "$(readlink "$dst" 2>/dev/null)" = "$src" ] || ln -sfn "$src" "$dst"
  # No trailing slash: to git, a link is not a directory.
  grep -qxF "/skills/$name" "$exclude" 2>/dev/null || echo "/skills/$name" >> "$exclude"
done
exit "$status"
