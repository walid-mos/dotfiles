# Rules for ~/.config/pi

- `package.json`, `README.md` and this file are managed by chezmoi: change them in
  `~/.dotfiles/dot_config/pi/`, then `chezmoi apply ~/.config/pi`. An edit made here is overwritten at the next apply.
- Each `pi-*` directory is its own git repository with its own `AGENTS.md`: read it, and commit and push in that
  repository, not here.
- Where a resource goes:
  - generic, shareable with anyone: `~/.pi/agent` (public `pi-agent`);
  - third-party, unedited: `pi-vendor`, through its update procedure;
  - private to a client or a company: that domain's `pi-<name>`.
- The domains never mix: nothing of one `pi-<name>` (names, repositories, people, tickets, secrets) is copied into
  another, nor into the public repositories (`pi-agent`, `pi-vendor`, dotfiles), because each domain is isolated from
  the others.
- `package.json` matches repositories by pattern and must keep naming none of them. The one exception is a vendored
  extension, added by its path after its review in `pi-vendor`.
- After a change to what loads, start a fresh session (`pi -p --no-session ...`) and check that the expected skills
  are listed and that Pi prints no collision or extension warning.
