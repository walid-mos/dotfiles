---
name: pi-updated
description: Re-establish that house display adapters and extensions work on a new pi release - changelog breakage review between the audited and installed version, extension-API audit, display-ABI audit, glyph/format re-diff, and re-application of audited dist patches. Use when the drift widget appears ("run /skill:pi-updated"), after upgrading pi, or when an adapter or extension fails with a "missing; re-audit" error.
---

# Pi update re-audit

This user-requested Pi harness maintenance is the narrow exception in `~/.pi/agent/AGENTS.md` § Third-party code: inspect installed Pi dist sources and reapply only audited dist patches. It does not permit patching other dependencies or incidental Pi internals.

Goal: make the running pi release the audited one (`AUDITED_PI_VERSION` in
`~/.pi/agent/extensions/ui/pi-runtime.ts`) and prove nothing else broke. There is no hard pin — the
adapters always load; this skill re-establishes that they and the other extensions actually work.
Three audits, in order of information value:

1. **Changelog breakage review** — what the release says it changed, read against what the
   extensions rely on.
2. **Extension-API audit** — every `pi.on`, registration call and `ctx.ui` call the extensions make
   still exists in the installed package.
3. **Display ABI audit** — the reflected runtime members and patched prototype methods the display
   adapters use (existing `abi-audit.ts`).

## Procedure

The decision to change pi or herdr source at all is governed by `~/.pi/agent/skills/harness-tuning/SKILL.md` § Modifying pi or herdr; this skill owns the mechanics: the `scripts/SOURCE.md` patch registry and the `pi-patch-*.py` reapply scripts.

1. **Scope.** Read the installed pi version (`node -e "import('<pi bundle>/dist/bundle/index.js').then(m => console.log(m.VERSION))"`)
   and `AUDITED_PI_VERSION`. Equal → nothing to do, report it.
2. **Changelog breakage review.** From `~/.pi/agent` run:

   ```bash
   node --experimental-transform-types skills/pi-updated/scripts/changelog-diff.ts
   ```

   It prints the installed package's `CHANGELOG.md` sections between `AUDITED_PI_VERSION`
   (exclusive) and the installed version (inclusive). Read every **Breaking Changes** entry, then
   **Changed**/**Added** entries that touch extension surfaces (hooks and events, `ctx.ui`, editor,
   autocomplete, tool registration, message renderers, TUI components, event-bus dispatch
   semantics) and cross-reference them against the extension-API audit below and the
   `extensions/` that use those APIs. Known blind spot this step exists for: 0.85→0.86 changed the
   event-bus dispatch so a listener registered *during* a `session_start` dispatch missed that same
   dispatch — name-level ABI checks passed while `inline-skills`' `/skill:` trigger silently died.
   Record every consequence in DESIGN.md §10. If the installed CHANGELOG lacks the audited
   version's section, `npm pack @earendil-works/pi-coding-agent@<AUDITED_PI_VERSION>` and read it
   from the tarball.
3. **Extension-API audit.** From `~/.pi/agent` run:

   ```bash
   node --experimental-transform-types skills/pi-updated/scripts/extension-audit.ts
   ```

   It scans `extensions/**` for every `pi.on('…')` event, every `pi.<method>(…)` registration call
   and every `ctx.ui.<method>(…)` call, and checks each against the installed package's
   `ExtensionAPI` and `ExtensionUIContext` declarations (`dist/core/extensions/types.d.ts`).
   Every `✗` line is an extension call the new release dropped or renamed. Fix the affected
   extension against the new API.
4. **Class-level display ABI audit.** From `~/.pi/agent` run:

   ```bash
   node --experimental-transform-types skills/pi-updated/scripts/abi-audit.ts
   ```

   It locates the installed bundle, greps the adapter sources for every
   `reflectMember(runtime, '…')` member, and checks each component prototype
   method against the running bundle. Every `✗` line is a broken member.
   If the adapters gained or lost a patch since the last audit, update the
   `COMPONENT_METHODS` table in the script to match the `*-surface.ts` files first.
5. **Fix the failures.** Fix the failing `*-surface.ts` adapter against the new
   dist sources — never the callers. The display contract lives in
   `~/.pi/agent/extensions/DESIGN.md` §2–§4; do not redesign it as a side effect.
6. **Re-apply dist patches.** A release replaces `@earendil-works/pi-tui/dist/components/editor.js`, wiping the per-repo prompt-history patch (↑/↓ history persisted per working directory, not per session — `scripts/SOURCE.md` is the registry of all audited patches; reapply every one of them here, not just prompt-history). From `~/.pi/agent` run:

   ```bash
   python3 skills/pi-updated/scripts/pi-patch-prompt-history.py
   ```

   Every line must end `patched (…)` or `already patched`; `introuvable` means the glob patterns in the script no longer match the installed layout — update them. During a user-requested Pi harness update, do this after the upgrade even when the rest of this skill was not invoked.
7. **Glyph/format re-diff.** Per DESIGN.md §10, `rg` the new dist sources for
   drift: `dist/core/tools/renderers/*.js`, `dist/modes/interactive/components/*.js`,
   `@earendil-works/pi-tui/dist/components/markdown.js`. Record decisions in DESIGN.md.
8. **Visual pass.** Only for the surfaces that changed, per DESIGN.md §9
   (pending/streaming/settled/failed, narrow viewport, mouse + Ctrl+O expansion).
9. **Close out.** Bump `AUDITED_PI_VERSION` to the running version, update the DESIGN.md header and
   §10, then from `~/.pi/agent`:

   ```bash
   pnpm run lint && pnpm run type-check && pnpm exec oxfmt --write <touched .ts files>
   ```

   End by telling the user to `/reload`; the widget disappears on the next session.

## Limits

- All three scripts check names and signatures only. Semantic drift — dispatch order, event-bus
  listener timing, result-shape contracts, instance-level fields (`host.text`, `contentContainer`,
  message shapes) — is caught by the changelog review and the §9 visual pass, never by the scripts.
- `patchPiComponent` and `invokePiMethod` throw their own "re-audit" errors at
  install/render time; a fresh error line in the session is an audit finding too.
- `extension-audit.ts` trusts the installed `.d.ts` declarations; if a release changes behavior
  without renaming anything, only the changelog review and the visual pass catch it.
