# DESIGN.md — pi rendering surface map + restyle migration list

Single source of truth for restyling pi's TUI. Read this before migrating ANY render surface
(tool rows, chrome, transcript surfaces) to the house design system.

- Verified against installed `@earendil-works/pi-coding-agent@0.87.1` + `@earendil-works/pi-tui@0.87.1` dist sources.
- Re-diff this matrix after every pi upgrade; glyph/format details can shift between versions.
- Ownership rules live in `~/.pi/agent/ARCHITECTURE.md`. This file tracks *what renders*, not *who owns which module*.

## Status legend

- `- [ ]` not migrated (still on pi default styling)
- `- [x]` migrated (renders through `ui/design-system` or an owned component)
- `- [~]` intentionally skipped (pi default is accepted)

## Current state

The activity design system now covers **every `ToolExecutionComponent`**, not an allowlist of
registered tool names. This includes built-ins, package tools such as `subagent`, future/dynamically
loaded tools, and restored calls whose definition is no longer installed. `compact` tool calls use
the fallback; Pi's separate compaction-summary card has its own adapter to the same shell.

The first dedicated presentations are **read, grep, glob (Pi's `find`), bash**, plus subagent
identity. Other tools share the fallback header and preserve their native expanded detail renderer.
No tool schema, execution function, result payload, or activation list is changed.

Already owned elsewhere: footer, questionnaire dialog/content, prompt top border and telemetry,
attachment strips, and framed literal user prompts. Assistant responses now belong to `renderers/` and use
the response hierarchy below. Notifications, manual `!` shell
blocks, compaction/retry loaders, dialogs and general editor chrome are not tool-execution rows;
those remain separate migrations below. Do not claim the entire TUI is migrated.

---

## 1. Overlay infrastructure

- [x] Design system: `ui/design-system/theme.ts` owns semantic roles; `palette.ts` reads `themes/catppuccin-latte.json` vars; `terminal-color.ts` owns parsing/blending.
- [x] Text policy: `ui/terminal-text.ts` owns clipping/wrapping/hanging indent (pi TUI stays the only tokenizer).
- [x] Frames/surfaces: `ui/align.ts`, `ui/frame.ts`, `ui/selection-marker.ts`, `ui/surface.ts` + `ui/ordered-widget-stack.ts`.
- [x] Editor decorator composition: `ui/editor-decorator.ts` chains on pi's `getEditorComponent` exactly once per session.
- [x] Base editor: `ui/editor-decorator.ts` also exports `createDefaultEditor` (pi's `CustomEditor` with `embedWorkingStatus: true`), the base every decorator chains onto.
- [x] Renderer adapter: `renderers/install-renderers.ts` binds the running CLI's classes; version drift is warned by a widget (`ui/renderer-drift.ts`), never a refused load. No duplicate `registerTool` ownership and no execution passthroughs.
- [x] Shared activity layout: `ui/activity-line.ts` / `ui/activity-details.ts`; semantic colors come from `ui/design-system`.

## 2. Activity design contract

- **Ordinary tools occupy one collapsed physical line** in every state, except image captures
  described below. Edit/write instead use
  standalone panels throughout their lifecycle. Applied mutations show code; pending,
  cancelled and failed panels show their status/evidence without inventing an applied diff.
- A fixed two-column rail, fixed status slot and bold tool
  names in the same accent as the Answer title. The name opens a shared identity column and its
  count closes it, so counts stack on one right edge and the task text starts on one column for
  every name that fits; a longer name or count takes the extra width rather than become ambiguous.
  Then come task text and the quiet timing/failure group. No right-hand disclosure arrow is drawn.
  Counts retain compact units (`15l`, `1img`, `12f`); async launch receipts use `async`. Errors/cancellations appear
  at the right, beside elapsed time, never in the count column. Critical diagnostics/warnings still
  lead the task rather than disappear. Status color never floods the whole row green/red.
  Only the last collapsed call in a tool chain closes with `╰─`; earlier calls retain `├─`.
  Hidden thinking and intermediate assistant updates do not split a chain into per-batch endings.
  Final answers, user messages, terminal notices and panels end it. Expanded ordinary calls
  keep their detail rail. Panels have their own full frame with no external activity rail.
  Ordinary rows have no boxes, duplicate titles or blank separators; mutation code uses the framed
  template below.
- Rows, expanded details and standalone panels start their own text on the same content column
  (`ACTIVITY_CONTENT_COLUMN`); the detail gutter and the panel insets derive from it instead of
  carrying private paddings. Word spacing stays tight even in wide viewports and nothing grows with
  width. Descriptions use
  quieter body ink; all normal counts and timing recede, while failures retain semantic color.
  Vertical breathing room comes from terminal cell metrics (Ghostty's font config), never extra tool rows.
- Clip by terminal columns at the final viewport width; flatten multiline subjects only in the
  header. Wide graphemes never overrun the terminal. Expanded content retains the full command,
  path and result, with an aligned detail gutter.
- Running rows share one lazy repaint pulse; delivered read/search/bash partial output updates its
  compact count beside the active spinner, without a `live` prefix. Empty partials keep the count
  lane empty and remain running, never done; native async tools do
  not claim launch completion from a partial result. Completed clocks freeze. Measured durations
  survive `/reload` while Pi retains the same result content; newly loaded, unmeasured history gets
  no invented duration. Remounting an already-completed component never records a fake zero-time run.
  Elapsed duration and configured timeout are both visible (`2.4s · 120s max`), clearly distinguished.
  Execution arguments remain untouched. Compact layouts shed timeout information before elapsed
  time, and preserve failure labels last. Timing vocabulary and budgets live in `ui/activity-timing.ts`.
- Click the header in fullscreen mode; keyboard expansion uses Pi's `app.tools.expand` state
  (Ctrl+O by default). No extra keybinding registration. Expanded native controls retain mouse
  routing; selection/scrolling are not hijacked.
- Any result carrying native image components renders as a capture panel: the same full frame as
  edit/write, with an uppercase heading, a status/timing strip, the captures inside the frame on the
  shared content column and a footer count. A headless browser check therefore reads like any other
  action and never floats an image under a one-line row. Several captures stack with one blank framed
  row above them; expansion adds the text details below the captures. Pi's native image
  rendering/conversion and the show-images setting are retained, and with images unavailable the row
  falls back to its ordinary one-line form rather than drawing an empty frame. Expansion never
  duplicates a screenshot. Truncation/limit warnings remain visible in the summary, full-output paths
  stay available in details.
- Native custom detail renderers retain their shared state and separate slot caches. Missing,
  malformed or throwing renderers fall back to readable source output; they never erase evidence.
- Pi has no public global tool-renderer hook in the audited release. The private display adapter
  is deliberate and tested, not a claim of an officially supported API. Upgrade verification is mandatory.

## 3. Tool coverage and first-pass presentations

| Surface | Collapsed presentation | Expanded content |
|---|---|---|
| `read` | Filename first, optional `Lstart-end`, muted parent directory (`~` for home), actual line/image count | Complete original path/args and returned text; native images |
| `grep` | Pattern, root/filter, result-line count (zero for no matches) | Args and complete returned search text |
| `find` / `glob` | `glob` display label, pattern/root, file count | Args and complete returned paths |
| `bash` | Conservative command preview, inline count, observed duration + explicit timeout/failure status | Complete original script and returned output; full-output path |
| `subagent` | Action/agent/workflow identity and topic/task, output count | Original package renderer, including guides and execution detail |
| `galley_agent` | `galley` display label, action + desk session, repository name, `live`/`idle` connection state | Original arguments and attachment description |
| `frontend_open` | `open` display label; capture panel headed by the page, scheme-less host/path and optional wait selector | Original arguments, page summary, native images |
| `frontend_act` | `act` display label; capture panel headed by action + target/key, `new tab` and post-action wait note | Original arguments, action result, native images |
| `frontend_screenshot` | `shot` display label; capture panel headed by selector or `full page`/`viewport`, viewport size | Original arguments, caption and captured image |
| `frontend_console` | `console` display label, level filter, `last N`, entry count | Original arguments and console text |
| `frontend_eval` | `eval` display label, single-line expression preview, result count | Original arguments and evaluated result |
| `bg_wait` | `wait` display label, run id or `any`/`all runs`, `non-blocking` note, timeout cap beside the elapsed clock | Original arguments and wait outcome |
| `subagent_supervisor` | `supervisor` display label, action + child target, single-line message preview | Original arguments and channel output |
| `edit` / `write` | Independent panel on the shared content column: uppercase heading, filename/status strip and numbered pastel diff preview | Same code template with the preview limit removed; native fallback when unsupported |
| `ls` | Filename/directory-name first, quiet home-shortened parent directory | Native call/result content with original arguments |
| Any other tool | Humanized tool name (separators become spaces), first known or first string argument, status/output count | Original call/result slots, else readable args/output |
| Compaction summary | Compact tool/token-count identity, `context` + `tokens before` annotation | Complete retained summary |

Coverage does not depend on this table: all tool names pass through the common adapter. The table
only defines specialized vocabulary, which lives in `tool-presentation.ts` for Pi's own tools and in
`package-presentations.ts` for tools registered by packages. A tool with no entry keeps the generic
shell: its name is humanized (`new_mcp_tool` → `new mcp tool`) and its subject is the first known
argument name, then the first string argument, so a raw identifier or an empty row never reaches the
transcript. `find` keeps its real execution name; `glob` is a display alias.
Success on an async launch means the tool returned successfully, not that the background job finished;
its execution details remain authoritative.

- [x] Dedicated one-line read/grep/glob/bash and subagent identity.
- [x] One content column for rows, detail gutters and panels; capture panels reuse the file-panel frame.
- [x] Package vocabulary for `galley_agent`, the five browser tools and the supervisor/wait tools.
- [x] Generic shell for write/edit/ls/powershell, web-access tools and unknown tools; an unknown tool's name is humanized rather than printed as a raw identifier.
- [x] Separate compaction-summary component adapter.
- [x] Edit/write share an inline and expanded mutation-code view; no separate tool registration or execution wrapper.
- [ ] Bespoke search-result detail views: retain native content.
- [x] Consistent filename-first hierarchy for read/edit/write/ls and home-shortened parent paths, without rewriting stored arguments.
- [x] `renderers/bash-preview.ts` shows a conservative source excerpt: literal leading `cd` setup becomes
  context, common chaining/redirection tails are omitted with `…`, and quoted operators are preserved.
  Nested substitutions fall back to the original first line. It never evaluates or rewrites execution.
- [ ] Path hyperlinks / syntax-enhanced read details: future polish, not hidden requirements.

### Mutation preview contract

- Inspired by the numbered code and pastel rows in [the former mutation view](https://github.com/walid-mos/mac-config/tree/develop-pi/pi/.pi/agent/extensions/mutation-view), not its framing or tool overrides.
- Successful edits use Pi's persisted, numbered diff. Writes compare against a bounded preflight
  before-image when available; new files are genuinely all-added. A write without a trustworthy
  baseline shows labeled neutral written content, not a fictional all-green diff.
- Edit/write no longer borrow the ordinary bash/read/search header. Their full-width, square file
  panel has a lilac frame, uppercase `EDIT`/`WRITE` heading, bold filename, quiet directory and a
  separate status/elapsed strip. The footer owns change counts and fold/expand controls. Pending,
  failed and unsupported-result views keep the same panel identity; native details remain available.
  Numbered gutters, `+`/`-` markers and pastel rows retain the house palette. There is no external
  activity rail, duplicated tool row, rounded corner or far-right disclosure arrow.
- The default preview is capped by visual rows; expansion uses the same header, widths, colors and
  exact visible code prefix, only revealing remaining rows. Long lines wrap with continuation gutters.
  Code/control bytes are displayed safely, not interpreted as Markdown or terminal instructions.
- The footer carries exact addition/removal counts and the click/Ctrl+O affordance. A single click
  anywhere on the applied panel opens or folds it; the same code position works in both directions.
  Press, drag, release and movement events do not toggle. Pi's viewport emits a click only for a
  stationary gesture, so dragging remains available for selection.
- No animation timer or asynchronous work runs during rendering. Native renderers previously mounted
  while a call was pending still receive completion so their resources can settle before replacement.
- Before-images and diff work are bounded in `change-document.ts` / `write-snapshots.ts`. Special path
  aliases, unavailable/binary/large baselines, older writes without before-images and oversized replacements use
  explicit content/native fallbacks. Saved tool arguments/results are untouched; weak caches retain
  observed write comparisons across `/reload`, not across fresh-process history loading.

## 4. Transcript message surfaces

- [x] Questionnaire transcript cards (own renderer via `registerMessageRenderer` path).
- [x] User message: literal source inside the shared rounded house frame through `renderers/`, with a rail-colored **❯** marker, accented **Prompt** label, softly tinted blue border, solid closing rule, preserved paragraph breaks and matching outer gaps. One blank row inside each edge gives the text breathing room; compact viewports omit the marker before sacrificing the label. Frame edges span the same viewport as tool rows; wrapping reserves both rails and inner padding. Extremely narrow viewports drop the frame rather than hide the prompt. Native OSC prompt zones remain intact; reinstall replaces styling closures without stacking frames.
- [x] Submitted attachments: thumbnails and aliases sit inside the owning prompt frame, above its literal text, with one separating blank row. The native custom entry is relocated, not duplicated; its persisted position and payload are unchanged. Replay and native user rebuilds preserve the placement; unmatched/orphan entries retain their standalone fallback. Draft-editor strip placement is unchanged.
- [x] Assistant: `renderers/assistant-surface.ts` with centered response landmarks and house Markdown; no raw-source override remains in `renderers/`.
- [x] Thinking: separate muted content, existing visibility setting and per-run mouse expansion retained; never styled as a final answer.
- [ ] Custom message cards: `Box` + bold `[customType]` (`customMessageLabel`) + `customMessageText` (`registerMessageRenderer`).
- [ ] Custom entry cards: `customMessageBg` (`registerEntryRenderer`, TUI-only, not in LLM context).
- Event order fact (pi 0.85.1): `agent_start` → `turn_start` → the prompt's `message_start`/`message_end`, and a
  session entry is written **at that `message_end`**. Anything that must land *after* a submitted prompt
  (e.g. `prompt-attachments`' transcript strip) therefore claims its slot on the following `context`
  event, the first hook where the prompt is the branch leaf and the reply has not been appended yet.
  The attachment entry remains after the prompt in storage; the display adapter nests it before the text.
- [ ] `!` bash row (`bash-execution.js`): `bashMode` bold header pad-1; output `muted`; status muted / `(cancelled)` warning / `(exit N)` error; truncated → full-output path notice. Not overridable — restyle = theme tokens (`bashMode`, `muted`) or rebuild via `registerEntryRenderer`? (verify feasibility before scheduling; may be `- [~]`).
- [ ] notify lines: NOT toasts — transcript lines: `dim` (consecutive dedupes into one line), `warning`, `Error: msg` in `error`; each after `Spacer(1)`.
- [x] Compaction summary: common activity shell through `renderers/compaction-surface.ts`, with click and keyboard expansion.
- [x] Skill invocation card: `renderers/skill-block.ts` renders the parsed skill block as a rose-wash callout band
  (pink `✦ skill ·` identity, bold skill name, `click / Ctrl+O` hint resolved from Pi's keybindings, source location and house
  Markdown body when expanded) and `skill-surface.ts` mounts it on Pi's native component, keeping the global toggle; a
  stationary left click anywhere on the band folds or expands the card, like the mutation panels.
  The band is painted per column and per row: a pink spine anchors the top-left edge and the rose light it casts eases
  monotonically into the transcript background, under the text and past it, while each row keeps a diminishing share of
  the peak, so the glow dissolves to the right and downward with no flat block, no seam and no hard end. Static paint
  only - no timer, no repaint loop.
- [ ] Branch-summary cards and live compaction/retry loaders: separate native surfaces, not covered by the tool adapter.

### Response design contract

- Intermediate updates get a short centered muted rule and a smaller, fainter matching rule below
  their content, including interruption notices. Final answers retain only their wider accented
  header, restrained ornament and bold **Answer** label. Header/body spacing stays stable during
  completion; the intermediate footer retires without moving the answer text.
  Response messages have matching outer top and bottom gaps to separate them from adjacent tool calls;
  empty/tool-only messages and thinking controls receive no extra response padding.
- Assistant error/interruption notices use `ui/activity-notice.ts`: the marker aligns with tool status,
  text aligns with tool names, and long details wrap at that same inset. Both marker and message use
  bold semantic ink: red for errors, orange for interruptions. This distinguishes notices from normal
  tool-body text without adding a box, rail, disclosure, or changing the diagnostic wording.
- Paragraph breaks provide breathing room; headings and list markers use accent, bold prose stays
  readable neutral ink, links are distinct, and code/quotes have quieter structure. Pi still owns
  Markdown parsing, syntax highlighting, tables, links and streamed fence handling. Existing Markdown
  transformers retain their width, message-type, streaming and exception-isolation contracts.
- Explicit provider phase metadata separates commentary from final text, including mixed messages.
  Without it, streaming stays neutral; a settled, tool-free `stop` is final. Interrupted, truncated
  and failed responses keep their notices and are not promoted to final. No text/keyword heuristics.
- Empty/tool-only messages get no decorative separators. Thinking stays distinct. User prompts keep
  their separate literal frame; response styling never changes tool execution or stored content.
- Shared semantic colors and blending implement the fades; there is no second palette. Width-aware
  cached components avoid repaint-time parsing/blending. Narrow layouts never overflow.

## 5. Chrome (editor + footer + status)

- [x] Footer (own implementation; vector quota gauges, `ui/ordered-widget-stack` mounting).
- [x] Working indicator (word rotation/shuffle-bag), embedded in the prompt's top border — never a standalone row above it.
- [x] Editor top border: `prompt-telemetry/activity-border.ts` right-aligns its activity block after the
  loader reserve (`EMBEDDED_LOADER_FIELD_WIDTH`), never over the loader or pi's `↑ N more` scroll label.
  Readings wear the loading color (pi gives the embedded spinner and its message the editor's own
  `borderColor`, so numbers, tally icons and the clock mark take that same hue) while their words stay muted
  (house `muted` ink mixed toward the background at `CHROME_QUIET_RATIO`; `DATA_QUIET_RATIO` is only the
  numbers' fallback for an editor without a border color). Until the provider reports a count the track
  sweeps through the readings' columns with the wait named at the row's right edge - nothing blank - and the
  renderer fixes block width, so neither a landing count nor the loader rotation can move it. A settled
  block stays frozen (`✓ mm:ss`) until the next prompt: no retire timer exists. Layout depends on pi's
  `── <status> ──…` border; re-diff on upgrade (§10).
- [ ] Editor: border color = `getThinkingBorderColor(level)` (`thinkingOff`→`thinkingMax`), `bashMode` in `!` mode; border glyphs `── label ──`. Editor is replaceable via `setEditorComponent`/editor-decorator — decide scope (border tint vs full owner-drawn editor).
- [ ] Widgets: todo/progress widgets above/below editor via `setWidget` (`ui/surface.ts` already owns registrations) — add house-styled content when a widget feature lands (no current surface → open).
- [ ] Autocomplete menu: in-editor `SelectList` (`accent` selection, `muted` descriptions) + `borderMuted` border. Only reachable via theme tokens unless the editor is fully owned. Mark `- [~]` initially.

## 6. Dialogs & overlays

- [x] Questionnaire (select/multi/confirm-like flows inside the house questionnaire).
- [x] Model picker (`/models`): owns its chrome in `ctx.ui.custom` - header (one labelled line each for the session model, the startup default and the ctrl+p count, then the agent pins; `model-picker-words.ts` owns those three names), tab strip for session/ctrl+p/fallbacks/agents, search, one shared reasoning column (`model-picker-effort.ts`: squares plus the level's own name, right-aligned, inherited/off/unavailable spelled out - a width-safe `!` marker stands in for `unsupported` below 72 columns - never an invented `auto`), price gauge with its formula disclosed, click-to-select and wheel over the list. Chain and toggle edits persist as they are made; a session model or reasoning choice is pending until enter, so escape changes nothing. The Ctrl+P list tab (labelled `ctrl+p`) lists the `enabledModels` entries once each, every row saying `Ctrl+P list`, `in Ctrl+P list via <pattern>` or `not in Ctrl+P list`: enter (or space) toggles membership - an exact entry leaves the list, a session-only model joins it as its own exact entry, a model a saved pattern already covers is added as one - backspace removes an entry whole (a wildcard included, which the footer labels it for), and alt+up/down saves their manual order as one list. The session catalogue's space toggles the highlighted model's membership in that same list (so the key that edits the list is the same one on both lists), one legend line above the catalogue says what the list and the startup default are, its ctrl+s saves the highlighted row as the startup default new sessions begin with (pi's own `defaultProvider`/`defaultModel`, and a save of the default already in place writes nothing), and enter still switches the session model; the session search field gives up the space character, which no model id contains. A wildcard moves whole, is never expanded, and a membership toggle never rewrites one. Since pi resolves the scope at session start (and `ctx.scopedModels` is read-only) the tab states that an edit applies from the next session start while the picker's own session list and agents tab follow it immediately: the catalogue re-reads the list on every keystroke, so a model the list names exactly leaves the `available` rest for the `in Ctrl+P list next session` group (between `in Ctrl+P list now` and `available`, tagged `not cycling now  in Ctrl+P list`) the moment it is added and drops back when it is removed - no relaunch needed to see it in the right list. It still names pi's own `/scoped-models` selector for the same list - a built-in command no extension can dispatch, so the tab states it rather than faking an action. A row the running session does not cycle is tagged `not cycling now`, never `out of Ctrl+P list`, so a model a saved pattern covers reads as two separate facts rather than a contradiction. The agents tab lists every agent the `subagents` package reports (its roster read over pi's event bus, `agent-roster.ts`) with the model it would run - named as a pin, the agent's own definition, `subagents.defaultModel` or an inherited session model - plus the same reasoning column, where left/right writes only that agent's thinking (clamped to the model's own levels) and enter or a click opens the inline model editor; a pin whose agent no longer exists stays listed, marked `no such agent`, so it can be repointed; the editor opens on the pinned model or on an explicit no-model-change row when the agent has no model row (a stored level alone, or a model the catalogue cannot resolve, which the header names as not in the catalogue), shows a stored level the pinned model does not accept, marked `unsupported`, and an untouched save writes nothing; per-agent models otherwise stay with the `subagents` command, which the agents tab opens (after releasing its own modal) once it is registered.
- [ ] `ctx.ui.select/confirm/input/editor` built-in dialogs — colors only (`text/accent/dim/muted`, keyHint `muted/dim`). Decide `- [~]` or replace with `ctx.ui.custom` house dialogs reusing `ui/frame.ts`.
- [ ] Transient overlays: BorderedLoader (spinner + `border` frame), countdown dialogs — colors only. `- [~]` unless UX says otherwise.
- [ ] Fullscreen `ctx.ui.custom` for anything that needs owned chrome (pattern stays in extensions docs; do not duplicate here).

## 7. Fixed-in-code blacklist (theme cannot touch; override needed or accepted)

Confirmed glyphs/dims in pi 0.85.1 — record decisions here instead of re-discovering:

- [ ] `Spacer(1)` spacings + `Box(1,1)` paddings (user msg, tool rows, custom cards) → only via `renderShell: "self"` / owned components.
- [x] Working status: pi prints the loader as a standalone row above the widget container — whose `Spacer(1)` then reads as a blank gap above the prompt — unless the editor opts into the border with `embedWorkingStatus: true`.
- [ ] Markdown glyphs: quote border `│ ` (+ italic quote), fences ` ```lang `, hr `"─".repeat(min(w,80))`, bullets `- ` / `1. ` / preserved markers / task `[x] ``[ ] `, tables bordered with `─`, h1 = bold+underline, h2+ = bold, links `mdLink` underline + ` (url)` in `mdLinkUrl` when href ≠ text, `addition/deletion` reusing `toolDiffAdded/Removed`, LaTeX via `renderLatex`, mermaid → ASCII art.
- [ ] Editor glyphs `── `, ` ──`; settings cursor `accent "→ "`; footer glyphs `↑ ↓ R W CH •` (irrelevant — footer is owned).
- [ ] Spinner frames `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` @80ms (pi-tui Loader default) — replaced by `setWorkingIndicator` (done). Re-checked in 0.86.1: `pi-tui` loader frames unchanged; pi's dist no longer inlines them.
- [ ] Phrase set `... (N more lines, to expand)`, `[Truncated: ...]`, `[invalid arg]`, `[invalid content arg - expected string]` — restyle = our own phrasing in tool renderer overrides.
- [ ] `PS>`/`$` prompts — inside tool renderers, overridable. (`[skill]` cards are house-styled by `renderers/`, not this layer.)
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
3. Visual pass for this slice: read/grep/glob/bash and subagent `list`/`guide` in pending,
   streaming, failed and settled states; narrow terminal; mouse expansion and keyboard expansion;
   image read; compaction card; unknown tool. One collapsed line, aligned gutter, no flashing status rows.
   For responses: intermediate/tool-calling text, final answers, mixed provider phases, streaming
   completion, interruption, Markdown/code/links, thinking expansion, and narrow/resized viewports.
   For submitted prompts: single/multiline source, paragraphs, code indentation, Unicode, consecutive
   prompts, surrounding tool/answer alignment, and reload from the former unboxed presentation.
   For attachments: Kitty/iTerm2 thumbnails, alias-only/narrow fallback, repeated prompts reusing
   aliases, resume without the original image files, and exactly one strip inside each owning frame.
4. Fullscreen vs regular: mouse input is fullscreen-only; keyboard expansion must work in both.
5. Mutation checks: new file, overwrite, multiple edit hunks, empty/whitespace code, long/wide lines,
   failed/pending calls, missing/large baselines, preview click, expanded selection and Ctrl+O. Verify
   the code prefix does not move or change color on expansion, repeated clicks fold at the same
   position, and ordinary tool chains close before independent mutation panels.
6. Reload: no stacked rails or old timers; measured durations survive native remounting and extension reload.
   Calls with identical text but different result content/IDs never inherit another call's duration;
   fresh history without recorded measurements stays unknown.
7. Automated contracts (currently absent): `tests/` was deleted on 2026-09-19 at the owner's request - a copy sits in
   `backups/tests-20260919-123023`, and `pnpm run test` matches nothing until tests return. Until then every
   verification here is manual, and no surface may claim an automated contract it no longer has.
   The explicit one-line regression was observed failing with the former two-line renderer.
8. Verify with Pi's real extension loader and bundled runtime, not just TypeScript import success.
   Automated tests do not establish font-specific visual quality; inspect the live TUI after `/reload`.

## 10. Version-drift workflow

There is no hard pin. `ui/pi-runtime.ts` exports `AUDITED_PI_VERSION` (the release the adapters
were last audited against) and `detectPiDrift`; the renderers extension mounts a warning widget
(`ui/renderer-drift.ts`) on drift and installs anyway — a broken adapter still surfaces its own
"missing; re-audit" error at install or render time. After upgrading pi, run the
`pi-updated` skill: its changelog-diff script prints the installed CHANGELOG.md sections between the
audited and installed versions (read every Breaking Changes entry against the surfaces the
extensions use); `skills/pi-updated/scripts/extension-audit.ts` verifies every `pi.on` event,
registration call and `ctx.ui` call under `extensions/` against the installed
`ExtensionAPI`/`ExtensionUIContext` declarations; `skills/pi-updated/scripts/abi-audit.ts` checks
class-level ABI (runtime exports + patched prototype methods against the running bundle). Then
`rg` the new `dist/core/tools/renderers/*.js`, `dist/modes/interactive/components/*.js`, and
`@earendil-works/pi-tui/dist/components/markdown.js` for glyph/format/token drift (line counts,
strings, token names), fix the adapters, and bump `AUDITED_PI_VERSION` plus this file before
continuing migration. The script cannot see instance-level fields (`host.text`, `contentContainer`,
message shapes); those are covered by the §9 visual pass. Attachment composition also depends on
`InteractiveMode.addCustomEntryToChat`, `CustomEntryComponent`'s native leading spacer/rebuild,
and `UserMessageComponent`'s child layout. The thumbnail boundary separates iTerm2 cursor-up
from its OSC with a style reset: Pi 0.85.1 otherwise mismeasures and can truncate the image payload.
Mutation rendering also relies on the public numbered-diff format and on execution-end extension
handlers preceding the TUI's result update. Re-check `createResultRegion` when upgrading: Pi wraps
renderer content in its own click-to-toggle region, which expanded mutation code must bypass.

Drift record 0.86.1 → 0.87.1 (2026-09-23, `pi-updated`): class-level ABI intact, no adapter
changes. pi-tui's `↑ N more` scroll-end indicator now centers on the full editor width and truncates
before the scrollbar column (`tui-alt-screen.js`) — the prompt's activity block keeps its
right-aligned reserve; recheck overlap on a narrow viewport in the next §5/§9 pass. 0.87.1 adds
`custom_message` replay and a compaction-boundary chat rebuild (`interactive-mode.js`); the rebuild
still adds the same `CompactionSummaryMessageComponent`, so `compaction-surface.ts` is unaffected,
and custom message cards remain on the §4 open list. Image `resizeOptions` plumbing
(`core/tools/read.js`, `utils/tool-result-images.js`) only feeds provider-side input limits, not the
display pipeline. No glyph/format drift in `dist/core/tools/renderers/`, the patched message
components, or `pi-tui/dist/components/markdown.js`.
