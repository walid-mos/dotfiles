---
name: pi-config
description: Our workflow for changing the user's Pi configuration and checking how Pi looks - where a theme, an extension (tool, message or entry renderer, footer, editor, widget), a setting or a keybinding goes, and how to screenshot Pi's terminal UI on a fake or real session without calling a model. Use when creating, editing or reviewing a Pi theme, extension, renderer, setting or keybinding, when the user asks to customize, restyle or redesign how Pi looks (transcript, tool calls, messages, footer, editor), after `pi update`, and whenever the user asks to see, preview, test or screenshot a Pi conversation, even for a one-line change. For a Pi skill, follow `~/.pi/agent/skills/harness/SKILL.md` instead.
---

# Pi configuration: change it, then look at it

Pi's manual is the reference for every API named here: the `docs/` directory of
`~/.pi/agent/install/releases/$(cat ~/.pi/agent/install/current-version)/node_modules/@earendil-works/pi-coding-agent/`.
For looks, read `tui.md`, `themes.md` and, in `extensions.md`, Custom Rendering, Message and Entry Rendering and
`pi.registerToolRenderer`.

## Where a change goes

| Change | Place |
|---|---|
| Colors | a theme, `~/.pi/agent/themes/<name>.json`, selected by `theme` in `settings.json` |
| How a tool call, message or entry is drawn; footer, editor, widgets | an extension, `~/.pi/agent/extensions/<name>.ts` or `<name>/index.ts` |
| Preferences, keys | `~/.pi/agent/settings.json`, `~/.pi/agent/keybindings.json` |
| An extension with npm dependencies | a package in `~/.config/pi` (Pi's `packages.md`): git tracks `~/.pi/agent/extensions/` whole, `node_modules` included |
| Anything private to a client | `~/.config/pi/pi-<domain>/` |

- Restyle a built-in tool with `pi.registerToolRenderer`, spreading `next()` and replacing only the slots you change:
  registering a tool of the same name would replace its execution too.
- Renderers take every color from the `theme` argument. Without a `theme` setting Pi uses `system`, built from the
  terminal's palette and rebuilt when it switches between light and dark, so a fixed color breaks one of the two.
- Tell the user to run `/reload` in open Pi sessions (Pi's `slash-commands.md` lists what it reloads). The active
  theme reloads by itself when its file is in `~/.pi/agent/themes/`.

## Look at the result

Judge a visual change from a capture, never from the code alone, and never from a model call (`pi -p`, a prompt): it
costs and gives a different conversation each time.

```sh
scripts/pishot.sh --out <scratch>/end.png --step key:ctrl+o --step shot:<scratch>/expanded.png
```

- It runs the real `pi` with the whole configuration, as a new session starts, on a fake session written by
  `scripts/make-session.mjs`: user text, hidden thinking, markdown with a table and code, read, bash, edit and write
  calls, and a failed bash call. `--session <file>` opens a copy of a real session from `~/.pi/agent/sessions/`
  instead, to see real content; the original is never written.
- Colors and font are the user's Herdr theme for the current macOS appearance; `--appearance light` or `dark` forces
  one.
- Arguments after `--` go to `pi`: `-e <file>` adds an extension that is not in place yet, `-ne -e <file>` loads only
  that one, `--theme <file> --use-theme <name>` a theme.
- Steps run in order: `key:<name>` (`ctrl+o` expands tool output, `pageup` scrolls up), `text:<chars>`,
  `wait:<seconds>`, `shot:<png>`. The last screen goes to `--out`. `scripts/pishot.sh --help` lists every option.
- `--blank` starts without a session: the startup screen, which lists the loaded context, skills and extensions and
  reports theme errors under `[Theme conflicts]` (raise `--rows` when the list is cut).
- Each PNG has a `.txt` twin with the screen text: search it rather than reading the image for text.
- Write captures to a scratch directory, never in a repository: they are for looking, not tests, and
  `~/.pi/agent/AGENTS.md` only allows tests that TDD produced.

Read every PNG with the Read tool and, for each element you changed, check:

- the default width and `--cols 60`: every line fits the width;
- `--appearance dark` and `light`, when colors changed;
- collapsed and expanded (`key:ctrl+o`), success and failure, for a tool renderer.

When `pishot.sh` exits non-zero, its message says why. A broken extension stops Pi at startup: the `.txt` then holds
Pi's error.

Then give the user the PNG paths with one line on what each shows.

## What a capture cannot show

- Running states: a session file only holds finished calls, so partial results (`isPartial`), loaders and streaming
  text never appear. Say so to the user, who checks them in a real session.
- Exact drawing: no ligatures, approximate emoji. When the exact look matters, give the user a live Pi in a Herdr tab
  (`herdr` skill) on a fake session: `node scripts/make-session.mjs <file.jsonl> <cwd>`, then
  `pi --session <file.jsonl> --offline` in that tab.

## After `pi update`

Rendering, theme and extension APIs change between releases. Read the new entries of `CHANGELOG.md` (beside `docs/`)
that touch them, then capture `--blank` and the fake session with the user's configuration and check that Pi starts
cleanly and that every customized element still looks as intended.

## Requirements

`scripts/pishot.sh` runs `scripts/pishot.py` in a virtualenv it creates in `~/.cache/pi-config/` on first use (this
needs the network); read `pishot.py` only to change how captures are made. It needs `python3`, `node`, `pi` on
`PATH`, macOS (its fonts and appearance setting), and Herdr's `~/.config/herdr-app/settings.json` unless `--font` and
`--palette` are given.
