# Custom Pi UI architecture

## Ownership and dependency direction

- `themes/catppuccin-latte.json` owns raw house colors. `extensions/ui/design-system/palette.ts` reads its `vars`; there is no second hex table.
- `extensions/ui/design-system/theme.ts` maps colors to semantic roles and styles. The custom UI intentionally keeps the existing fixed Latte appearance; runtime theme switching is not implemented here.
- `extensions/ui/design-system/terminal-color.ts` owns color parsing, blending and nested ANSI styling. Footer quota ramps use the same blending implementation.
- `extensions/ui/terminal-text.ts` owns clipping, wrapping and hanging-indent policy. Pi TUI owns Unicode/grapheme measurement and escape parsing; do not maintain another tokenizer or width table locally.
- `extensions/ui/align.ts`, `frame.ts`, and `selection-marker.ts` own shared spacing, rounded frames, focused-row bands and selection contrast. Frames compute clipping and padding themselves; callers provide content rather than precomputed width metrics.
- Questionnaire and footer modules own their domain content and interactions, not parallel UI engines. Shared `ui/` modules never import extension-specific modules and have no `index.ts` extension entry point.

## State lifetime

- Each questionnaire dialog owns its editor, navigation state, response collection and render cache. Keyboard events drive mutations on the TUI event loop; render functions only read domain state. The Pi editor computes its own layout during rendering.
- `QuestionnaireResponses` owns answers, drafts and multi-selection sets. Navigation owns the current tab/cursor; selection transitions operate through those owners. Plain snapshots cross the chat-pause boundary.
- The tool registration owns the map of chat-pause snapshots. It deletes a snapshot on completion/cancellation and clears the map on session shutdown, including reload.
- Pi owns tool-row state. The result renderer marks the row answered, and the call renderer then omits its pending preview. Invalidation is queued to avoid synchronous render reentry.
- `ui/surface.ts` owns widget registrations and subscriber notifications. `ui/ordered-widget-stack.ts` is the Pi mounting adapter, not another renderer or color system.

## Boundaries and verification

- `schema.ts` owns the tool-input shape; normalization derives its raw TypeScript types from that schema and enforces semantic constraints. Pending streamed previews read only the labels they display.
- Public output is bounded by terminal columns, not JavaScript string length. Editor rendering reserves enough space for a wide grapheme and cursor before the frame clips narrow viewports.
- Regression tests cover multiline/editor alignment, Unicode, styled wrapping, hyperlinks, narrow frames/surfaces, selection markers and footer color interpolation. They use Pi's real editor without starting terminal IO.
- Run the lint, type-check and test scripts from this directory. Format only changed code files. Use `/reload` and a visual questionnaire check after UI changes; automated tests do not establish font-specific appearance.
