# Custom Pi UI architecture

## Ownership and dependency direction

- `themes/catppuccin-latte.json` owns raw house colors. `extensions/ui/design-system/palette.ts` reads its `vars`; there is no second hex table.
- `extensions/ui/design-system/theme.ts` maps colors to semantic roles and styles. The custom UI intentionally keeps the existing fixed Latte appearance; runtime theme switching is not implemented here.
- `extensions/ui/design-system/terminal-color.ts` owns color parsing, blending and nested ANSI styling. Footer quota ramps use the same blending implementation.
- `extensions/ui/terminal-text.ts` owns clipping, wrapping and hanging-indent policy. Pi TUI owns Unicode/grapheme measurement and escape parsing; do not maintain another tokenizer or width table locally.
- `extensions/ui/align.ts`, `frame.ts`, and `selection-marker.ts` own shared spacing, rounded frames, focused-row bands and selection contrast. Frames compute clipping and padding themselves; callers provide content rather than precomputed width metrics.
- `extensions/ui/editor-decorator.ts` composes per-extension editor decorators exactly once per session_start, chaining on pi's `getEditorComponent`, and owns the base editor factory (`createDefaultEditor`). Only the first registered decorator builds that base editor, and extensions load in filesystem order, so every caller passes this factory instead of constructing its own. Decorators rebind instance methods (the sanctioned adapter hook) and accessor-intercept reassignable callbacks, because pi reassigns `onChange`/`onSubmit` after the editor factory runs; management of that contract lives here, not per extension. A decorator that renders dynamic content also receives the live TUI, so it can request its own repaints. It also owns `EMBEDDED_LOADER_FIELD_WIDTH`, the top-border columns reserved for the embedded loader, so decorators drawing beside the loader lay out against a stable field.
- Questionnaire and footer modules own their domain content and interactions, not parallel UI engines. Shared `ui/` modules never import extension-specific modules and have no `index.ts` extension entry point.

## State lifetime

- Each questionnaire dialog owns its editor, navigation state, response collection and render cache. Keyboard events drive mutations on the TUI event loop; render functions only read domain state. The Pi editor computes its own layout during rendering.
- `QuestionnaireResponses` owns answers, drafts and multi-selection sets. Navigation owns the current tab/cursor; selection transitions operate through those owners. Plain snapshots cross the chat-pause boundary.
- The tool registration owns the map of chat-pause snapshots. It deletes a snapshot on completion/cancellation and clears the map on session shutdown, including reload.
- Pi owns tool-row state. The result renderer marks the row answered, and the call renderer then omits its pending preview. Invalidation is queued to avoid synchronous render reentry.
- `prompt-telemetry` owns the prompt it tracks, the activity block it draws in the editor's top border, and its lifetime: the block renders from that state plus the current clock, with no tick timer and no retire timer of its own. Its numbers and tally icons wear the loading color while their words stay muted house ink, its elapsed track carries the prompt border hue, and before the first count the track sweeps the columns the readings will take - so the block reports and waits at one width, and a settled block stays frozen until the next prompt.
- `ui/surface.ts` owns widget registrations and subscriber notifications. `ui/ordered-widget-stack.ts` is the Pi mounting adapter, not another renderer or color system.

## Boundaries and verification

- `schema.ts` owns every tool-data shape: the LLM input schema and the canonical domain/`details` schemas; UI domain types derive from them via `Static`, so each field has one declared rule set. `normalizeQuestions()` enforces semantic constraints beyond shape (trimming, `Q{i}` fallbacks, uniqueness), and session replay re-validates through the same schemas (`Value.Parse`/`Value.Default`), falling back to plain text when the payload is unusable. Pending streamed previews read only the labels they display.
- Public output is bounded by terminal columns, not JavaScript string length. Editor rendering reserves enough space for a wide grapheme and cursor before the frame clips narrow viewports.
- Regression tests cover multiline/editor alignment, Unicode, styled wrapping, hyperlinks, narrow frames/surfaces, selection markers and footer color interpolation. They use Pi's real editor without starting terminal IO.
- Run the lint, type-check and test scripts from this directory. Format only changed code files. Use `/reload` and a visual questionnaire check after UI changes; automated tests do not establish font-specific appearance.
