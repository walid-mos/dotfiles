# DESIGN.md — pi rendering surface map + restyle migration list

Single source of truth for restyling pi's TUI. Read this before migrating ANY render surface
(tool rows, chrome, transcript surfaces) to the house design system.

- Verified against installed `@earendil-works/pi-coding-agent@0.85.1` + `@earendil-works/pi-tui@0.85.1` dist sources.
- Re-diff this matrix after every pi upgrade; glyph/format details can shift between versions.
- Ownership rules live in `~/.pi/agent/ARCHITECTURE.md`. This file tracks *what renders*, not *who owns which module*.

## Status legend

- `- [ ]` not migrated (still on pi default styling)
- `- [x]` migrated (renders through `ui/design-system` or an owned component)
- `- [~]` intentionally skipped (pi default is accepted)

## Current state (baseline)

Migrated already: footer (vector gauges/quotas), the ask-user-question questionnaire (transcript + dialog),
and the working indicator (`thinking-working` rotation/shuffle-bag words).

NOT yet touched: pi's built-in tool rows (the 8 tools), transcript message surfaces, `!` bash row,
notify lines, built-in dialogs, editor border/chrome details.

---

## 1. Overlay infrastructure

- [x] Design system: `ui/design-system/theme.ts` owns semantic roles; `palette.ts` reads `themes/catppuccin-latte.json` vars; `terminal-color.ts` owns parsing/blending.
- [x] Text policy: `ui/terminal-text.ts` owns clipping/wrapping/hanging indent (pi TUI stays the only tokenizer).
- [x] Frames/surfaces: `ui/align.ts`, `ui/frame.ts`, `ui/selection-marker.ts`, `ui/surface.ts` + `ui/ordered-widget-stack.ts`.
- [x] Editor decorator composition: `ui/editor-decorator.ts` chains on pi's `getEditorComponent` exactly once per session.
- [ ] Restyle extension skeleton (`extensions/tool-restyle/` or similar): registers renderer-only overrides for built-in tools (`registerTool` same-name, no `execute` → keeps built-in execution, replaces `renderCall`/`renderResult` per slot). Pi shows an interactive warning on override — accepted, documented.
- [ ] Decision per tool row: `renderShell` default (boxed `toolPendingBg/SuccessBg/ErrorBg`) vs `"self"` (tool draws its own frame from `ui/frame.ts`). Default candidate: `"self"` for full frame control.
- [ ] Export shared row-chrome helpers from `ui/` (header line, muted-hint line, truncation footer, status glyph) so all tool renderers reuse one implementation.

## 2. Tool rows — pi chrome (context for every tool override)

`tool-execution.js` behavior to replicate or drop when `renderShell: "self"`:

- `Spacer(1)` inserted before every tool row; `Box(1,1)` padding on default shell.
- Background: `toolPendingBg` → `toolSuccessBg` / `toolErrorBg` (isError) on settle.
- `MouseRegion`: left-click on result region toggles expanded; hints via `keyHint("app.tools.expand")`.
- Renderer crash → silent fallback to that slot's fallback (name + JSON args dump + raw output).
- Images in result content: `Spacer(1)` + `Image` (fallback styled `toolOutput`, `maxWidthCells` 60, kitty converts non-PNG→PNG). Shift to `renderShell: "self"` loses this unless reproduced.
- Hidden entirely when a renderer yields no content.

- [ ] Decide: keep pi collapse/expand (`context.expanded`, click region) vs house policy (auto-expand threshold, own `MouseRegion`). Implement in shared `ui/` helper before touching tools.

## 3. Built-in tool renderers — migration checklist

Exact current values (v0.85.1) so regressions are detectable. All collapsed previews end with
`... (N more lines, to expand)` in `muted`; all truncations are `[...]` blocks in `warning`.

- [ ] `read` (`dist/core/tools/renderers/read.js`)
  - Call: bold `read` + path (`accent`, `~`-shortened, OSC8 link) + `:start-end` range in `warning`.
  - Compact classification when collapsed: SKILL.md → `[skill] name`; pi docs → `read docs <label>`;
    AGENTS/CLAUDE.md → `read resource <label>`; hint `keyText("app.tools.expand") to expand`.
  - Result: syntax-highlighted content (badge in `toolOutput` when language unknown), 10 lines collapsed.
  - Truncation: `[Truncated: showing N of M lines (limit)]` / `[First line exceeds X limit]`.
- [ ] `bash` / `powershell` (`renderers/bash.js`, shared via `createShellRenderers("$"|"PS>")`)
  - Call: bold `${prompt} ${command}` + `(timeout Ns)` in `muted`.
  - Result: `toolOutput` lines; collapsed = **5 visual lines** (ANSI-aware wrap-truncate) with
    `... (N earlier lines, to expand)` header; live `Elapsed 3.2s` tick every 1s → `Took 3.2s` on settle.
  - Truncation: `[Full output: path. Truncated: N of M lines]` or byte-limit form.
- [ ] `edit` (`renderers/edit.js`) — the special one
  - Call box owns its own bg fn: **live preview diff computed during argument streaming** (async
    `computeEditsDiff`, `Spacer(1)` + diff inside the call box). Bg: preview ok→`toolSuccessBg`,
    preview error→`toolErrorBg`, settled error→`toolErrorBg`, else `toolPendingBg`.
  - Result: `error` text on failure; final diff (`Spacer(1)` + padX 1) if changed beyond preview.
  - Migration must reproduce the live-preview-then-settle state machine in the restyle extension.
- [ ] `write` (`renderers/write.js`)
  - Call: bold `write` + path + streamed content with incremental highlight cache (50-line rolling re-highlight, per-line after).
  - Result: only on error (error text). Collapsed 10 lines + `... (N more lines, M total, to expand)`.
- [ ] `grep` (`renderers/grep.js`)
  - Call: bold `grep` + `/pattern/` in `accent` + ` in path (glob) limit N` in `toolOutput`.
  - Result: `toolOutput` lines; collapsed 15.
- [ ] `find` (`renderers/find.js`)
  - Call: bold `find` + pattern `accent` + ` in path (limit N)`. Result: 20 lines collapsed.
- [ ] `ls` (`renderers/ls.js`)
  - Call: bold `ls` + path `(limit N)`. Result: 20 lines collapsed.
- [ ] Shared path helper parity: `accent` + `~` shorten + OSC8 hyperlink when supported;
  invalid arg → `error [invalid arg]`; empty → `toolOutput ...`. Reuse/mirror pi's semantics in `ui/`.
- [ ] Diff parity (`diff.js`): `-N line` / `+N line` / ` N line`; `toolDiffRemoved/Added/Context`;
  intra-line word diff with `theme.inverse()` on changed fragments (only 1:1 line substitutions);
  tabs → 3 spaces. House version must keep intra-line inverse highlighting.

## 4. Transcript message surfaces

- [x] Questionnaire transcript cards (own renderer via `registerMessageRenderer` path).
- [ ] User message: `Box(y1,x1)` + `userMessageBg`, Markdown `userMessageText`. Colors only — pad/glyphs fixed.
- [ ] Assistant: pad-1 Markdown (all `md*`/`syntax*` tokens); abort/truncated/error notes hard-coded `error`. Style via theme tokens + `registerMarkdownTransformer`.
- [ ] Thinking: `thinkingText`; hidden = italic label (customizable via `setHiddenThinkingLabel`).
- [ ] Custom message cards: `Box` + bold `[customType]` (`customMessageLabel`) + `customMessageText` (`registerMessageRenderer`).
- [ ] Custom entry cards: `customMessageBg` (`registerEntryRenderer`, TUI-only, not in LLM context).
- [ ] `!` bash row (`bash-execution.js`): `bashMode` bold header pad-1; output `muted`; status muted / `(cancelled)` warning / `(exit N)` error; truncated → full-output path notice. Not overridable — restyle = theme tokens (`bashMode`, `muted`) or rebuild via `registerEntryRenderer`? (verify feasibility before scheduling; may be `- [~]`).
- [ ] notify lines: NOT toasts — transcript lines: `dim` (consecutive dedupes into one line), `warning`, `Error: msg` in `error`; each after `Spacer(1)`.
- [ ] Compaction summary / branch summary / skill invocation cards: boxed markdown, `customMessage*` + `dim` + `keyText` hints. Fixed components; restyle = theme tokens only. Mark `- [~]` unless palette demands more.

## 5. Chrome (editor + footer + status)

- [x] Footer (own implementation; vector quota gauges, `ui/ordered-widget-stack` mounting).
- [x] Working indicator (word rotation/shuffle-bag).
- [ ] Editor: border color = `getThinkingBorderColor(level)` (`thinkingOff`→`thinkingMax`), `bashMode` in `!` mode; border glyphs `── label ──`. Editor is replaceable via `setEditorComponent`/editor-decorator — decide scope (border tint vs full owner-drawn editor).
- [ ] Widgets: todo/progress widgets above/below editor via `setWidget` (`ui/surface.ts` already owns registrations) — add house-styled content when a widget feature lands (no current surface → open).
- [ ] Autocomplete menu: in-editor `SelectList` (`accent` selection, `muted` descriptions) + `borderMuted` border. Only reachable via theme tokens unless the editor is fully owned. Mark `- [~]` initially.

## 6. Dialogs & overlays

- [x] Questionnaire (select/multi/confirm-like flows inside the house questionnaire).
- [ ] `ctx.ui.select/confirm/input/editor` built-in dialogs — colors only (`text/accent/dim/muted`, keyHint `muted/dim`). Decide `- [~]` or replace with `ctx.ui.custom` house dialogs reusing `ui/frame.ts`.
- [ ] Transient overlays: BorderedLoader (spinner + `border` frame), countdown dialogs — colors only. `- [~]` unless UX says otherwise.
- [ ] Fullscreen `ctx.ui.custom` for anything that needs owned chrome (pattern stays in extensions docs; do not duplicate here).

## 7. Fixed-in-code blacklist (theme cannot touch; override needed or accepted)

Confirmed glyphs/dims in pi 0.85.1 — record decisions here instead of re-discovering:

- [ ] `Spacer(1)` spacings + `Box(1,1)` paddings (user msg, tool rows, custom cards) → only via `renderShell: "self"` / owned components.
- [ ] Markdown glyphs: quote border `│ ` (+ italic quote), fences ` ```lang `, hr `"─".repeat(min(w,80))`, bullets `- ` / `1. ` / preserved markers / task `[x] ``[ ] `, tables bordered with `─`, h1 = bold+underline, h2+ = bold, links `mdLink` underline + ` (url)` in `mdLinkUrl` when href ≠ text, `addition/deletion` reusing `toolDiffAdded/Removed`, LaTeX via `renderLatex`, mermaid → ASCII art.
- [ ] Editor glyphs `── `, ` ──`; settings cursor `accent "→ "`; footer glyphs `↑ ↓ R W CH •` (irrelevant — footer is owned).
- [ ] Spinner frames `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` @80ms (pi-tui Loader default) — replaced by `setWorkingIndicator` (done).
- [ ] Phrase set `... (N more lines, to expand)`, `[Truncated: ...]`, `[invalid arg]`, `[invalid content arg - expected string]` — restyle = our own phrasing in tool renderer overrides.
- [ ] `PS>`/`$` prompts, `[skill]` tag text — inside tool renderers, overridable.
- [ ] Easter eggs (`/arminsayshi`, daxnuts, earendil announcement), mermaid ASCII colors — `- [~]`.

## 8. Token coverage checklist (theme layer, for hot-reload tuning)

53 required tokens + optional `thinkingMax`, `searchMatchBg/Text`, optional `export {pageBg, cardBg, infoBg}`.
House rule per `ARCHITECTURE.md`: `palette.ts` reads `themes/catppuccin-latte.json` vars — no second hex table.

- [ ] Map every generalized token group to palette vars: core 13 (`accent`, `border`, `borderAccent`, `borderMuted`, `success`, `error`, `warning`, `muted`, `dim`, `text`, `thinkingText`, `scrollbarTrack/Thumb`), backgrounds 11 (+2 opt: `selectedBg`, `searchMatch*`, `userMessage*`, `customMessage*`, `toolPendingBg`, `toolSuccessBg`, `toolErrorBg`, `toolTitle`, `toolOutput`), markdown 10, diffs 3, syntax 9 (cli-highlight theme mapping: title→`syntaxFunction`, class/type→`syntaxType`, tag→`syntaxPunctuation`, name→`syntaxKeyword`, attr/variable/params→`syntaxVariable`), thinking borders 7, `bashMode`.
- [ ] Verify no-lang highlight fallback → `mdCodeBlock`.
- [ ] Editor `EditorTheme.borderColor` derived from `borderMuted` (or per-level thinking tokens after §5 decision).
- [ ] Acceptance: theme hot-reload works from `~/.pi/agent/themes/` edit (automatic).

## 9. Verification protocol (per migrated tool/surface)

1. `pnpm run lint && pnpm run type-check` from `~/.pi/agent`; `pnpm exec oxfmt --write` touched files; `pnpm run test` when covered logic changed.
2. `/reload` in the session.
3. Visual pass for the migrated surface only, against §3 exact values (line counts, hint text, tick behavior, preview state machine for `edit`):
   - read: SKILL.md compact card + expanded highlighting; bash: 5-line preview + Elapsed tick; edit: streamed preview diff → settle; write: incremental highlight; grep/find/ls: collapse limits; diff intra-line inverse.
4. Fullscreen vs regular mode: mouse expand/collapse only matters in fullscreen (click region); keyboard flow must still work in regular mode.
5. Session reload: overridden renderers must render identically from restored session entries (renderers are presentation-only; no execution import needed — `withBuiltInRenderers` behavior).

## 10. Version-pinning note

All exact values in §3–§7 are validated for pi 0.85.1. After upgrading pi:
`rg` the new `dist/core/tools/renderers/*.js`, `dist/modes/interactive/components/*.js`, and
`@earendil-works/pi-tui/dist/components/markdown.js` for drift (line counts, glyph strings, token names),
then update this file before continuing migration.
