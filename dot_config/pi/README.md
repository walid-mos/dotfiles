# ~/.config/pi

The Pi resources that do not belong to the public `pi-agent` repository (`~/.pi/agent`): third-party packages and
private skills. Pi loads this whole directory as one local package, declared once in `~/.pi/agent/settings.json`:

```json
{ "packages": ["~/.config/pi"] }
```

## Layout

| Path | What | Source |
|---|---|---|
| `package.json` | Pi manifest: what Pi loads from the repositories below | dotfiles |
| `README.md`, `AGENTS.md` | this file, and the rules for agents working here | dotfiles |
| `pi-vendor/` | reviewed and pinned third-party packages, and our own packages with third-party dependencies (public) | `walid-mos/pi-vendor` |
| `pi-accor/` | private skills and extensions for Accor work | `walid-mos/pi-accor` |
| `pi-nextnode/` | private skills and extensions for Nextnode work | `NextNodeSolutions/pi-nextnode` |

The three repositories are cloned by chezmoi (`.chezmoiexternal.toml` of the dotfiles) and kept up to date on every
Mac by `reposync` (topic `auto-sync`).

## What Pi loads

`package.json` uses patterns, so it names no repository:

- `pi-*/skills`: every skill directory of every `pi-<name>` repository.
- `pi-vendor/packages/*/skills`: the skills of every vendored package.
- `pi-*/prompts/*.md`: the prompt templates (short commands) of every `pi-<name>` repository.
- `pi-*/extensions/index.ts`: the extension of a `pi-<name>` repository, if it has one. Vendored extensions are not
  matched: each one is added here by name, after its review in `pi-vendor`.
- `pi-vendor/packages/web/extensions/index.ts`: our own web package, the tools `web_search` and `fetch_content`.

A file that one of these patterns matches loads at the next Pi session (or `/reload`) once its repository is pulled.
Nothing else to declare.

## Add a private repository

1. Create `pi-<name>` (private) with `skills/` and, if needed, `extensions/index.ts`, and the topic `auto-sync`.
2. In the dotfiles: an entry in `.chezmoiexternal.toml` (`.config/pi/pi-<name>`) and one in
   `dot_config/reposync/config.toml.tmpl`.
3. `chezmoi apply` on each Mac, then restart `reposync` there (it reads its config only at startup).
