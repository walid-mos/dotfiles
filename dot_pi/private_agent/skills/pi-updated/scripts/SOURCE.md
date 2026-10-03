# Source

## pi-patch-prompt-history.py

- Upstream: `walid-mos/mac-config` (GitHub), `scripts/pi-patch-prompt-history.py`
- Revision vendored: `18332b380be1d819ecf79bfecce177b38af57524` (2026-09-02)
- Vendored on: 2026-09-21
- Local divergence: added macOS pnpm store patterns (`~/Library/pnpm/global/**/…`) — upstream only globs `~/.local/share/pnpm`, so it found nothing on macOS. Re-copy from upstream would reintroduce that gap until upstream is fixed.

## pi-patch-mermaid-never-drop.py

- House-authored 2026-09-28 (no upstream source; policy: `harness-tuning` § Modifying pi or herdr; ordered by the user after pi blanked every diagram it had a warning about).
- Upstream file: `packages/coding-agent/src/modes/interactive/components/mermaid.ts` in walid-mos/pi (fork of earendil-works/pi); installed targets `dist/modes/interactive/components/mermaid.js` and the inlined copy in `dist/bundle/chunks/chunk-OJP47DM6.js`.
- Change: (1) grok-mermaid warnings are advisory (types.d.ts) — pi used to replace the whole diagram with `Mermaid diagram not rendered: …`; now the art is drawn and the warning appended below it (`Mermaid diagram warning: …`). (2) Quoted two-dash link labels `A -- "label" --> B` are rewritten to the pipe form `A -->|"label"| B` before `render()` — grok-mermaid@0.2.3 drops the unrewritten form ("dropped, link has no target"); the rewrite fires only on that exact form. (3) A dangling connector (line ending in `-->`/`---`, optionally with a trailing pipe label) is an incomplete statement grok-mermaid drops and warns about; the truncator `truncateDanglingArrows` strips the trailing connector before render so the partially broken diagram renders clean without a warning. Comment (`%%`) lines, arrows with a real target, and lone `---` lines are untouched; dotted `-.->` and `==>` variants are deliberately not covered (their warnings still show under art). Left operand = any non-separator character (`[^\n\-| \t]`), so `)` / `]` / quoted node ids are handled; node ids grok-mermaid cannot parse at all (`[*]`, bare quoted ids) still show art + advisory warning (pre-existing parser limit, not the truncator).
- Install states handled: fresh (both helpers + call + never-drop), stage-1 v1 (upgrade in place), v2 with the earlier malformed truncator class (self-heal, keyed on evidence string `A-Za-z0-9_)]`), fully v2 (idempotent). Rewritten replacements go through functions (never re.sub templates) because a template turns `\n`/`\t` into real newline/tab and breaks the emitted JS regex.
- Audited against: pi 0.87.1 (the running install `3e4f681e…` resolves into the `f538-18d7…` store — one physical readable + one physical chunk file; the patcher dedups by realpath). Verified: script paths fresh/stage-1/heal all converge (mini byte-identical, readable adds two explanatory comment lines only), `node --check` clean, functional probe on the real readable: dangling bare/pipe-label/paren/quoted nodes render clean, dotted-dangling -> art + warning, quoted-label regression clean, clean control unchanged, pie passthrough, `%%` comment and lone `---` preserved, streaming withholds warnings. The minified anchors tolerate both template-literal `\n` spellings (escape vs live newline) because the two store builds differ. Reapply via `pi-updated` step 6 after every pi update.

## pi-patch-clipboard-osc52.py

- House-authored 2026-09-26 (no upstream source; policy: `harness-tuning` § Modifying pi or herdr).
- Upstream file: `packages/coding-agent/src/utils/clipboard.ts` in `walid-mos/pi` (fork of earendil-works/pi); installed target `dist/utils/clipboard.js`.
- Change: in `copyToClipboard`, when `HERDR_ENV` is set emit OSC 52 first and return — a native write targets the herdr server machine, while herdr forwards OSC 52 to the client's clipboard. Also removes the `WT_SESSION` Windows Terminal branch (the generic WSL PowerShell fallback remains).
- Audited against: pi 0.87.1. Reapply via `pi-updated` step 6 after every pi update.
- Origin: validated fix first made as repo commit `674a56b88` (branch `feat/herdr-clipboard-osc52`, deleted after conversion to this patch).

## pi-patch-remove-copy-command.py

- House-authored 2026-09-26 (no upstream source; policy: `harness-tuning` § Modifying pi or herdr; ordered directly by the user — never used).
- Upstream file: `packages/coding-agent/src/core/slash-commands.ts` in `walid-mos/pi` (fork of earendil-works/pi); installed target `dist/core/slash-commands.js`.
- Change: removes the `/copy` command registration ("Copy last agent message to clipboard"). The unreachable handler in interactive mode is left in place. Copying works via mouse copy-on-select and Cmd+V; no keyboard or slash command is needed.
- Audited against: pi 0.87.1. Reapply via `pi-updated` step 6 after every pi update.