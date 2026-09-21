---
name: pi-renderer-update
description: >-
  Re-audit the private Pi display adapters after a @earendil-works/pi-coding-agent upgrade:
  run the ABI audit script, fix the broken adapters against the new dist sources, and bump
  the audited version. Use when the drift widget appears ("run /skill:pi-renderer-update"),
  after upgrading pi, or when a raw-transcript/renderers adapter fails to load with a
  "missing; re-audit" error.
---

# Pi renderer update

Goal: make the running pi release the audited one (`AUDITED_PI_VERSION` in
`~/.pi/agent/extensions/ui/pi-runtime.ts`). There is no hard pin anymore — the
adapters always load; this skill re-establishes that they actually work.

## Procedure

1. **Scope.** Read the installed pi version (`node -e "import('<pi bundle>/dist/bundle/index.js').then(m => console.log(m.VERSION))"`)
   and `AUDITED_PI_VERSION`. Equal → nothing to do, report it.
2. **Class-level ABI audit.** From `~/.pi/agent` run:

   ```bash
   node --experimental-transform-types skills/pi-renderer-update/scripts/abi-audit.ts
   ```

   It locates the installed bundle, greps the adapter sources for every
   `reflectMember(runtime, '…')` member, and checks each component prototype
   method against the running bundle. Every `✗` line is a broken member.
   If the adapters gained or lost a patch since the last audit, update the
   `COMPONENT_METHODS` table in the script to match the `*-surface.ts` files first.
3. **Fix the failures.** Fix the failing `*-surface.ts` adapter against the new
   dist sources — never the callers. The display contract lives in
   `~/.pi/agent/extensions/DESIGN.md` §2–§4; do not redesign it as a side effect.
4. **Glyph/format re-diff.** Per DESIGN.md §10, `rg` the new dist sources for
   drift: `dist/core/tools/renderers/*.js`, `dist/modes/interactive/components/*.js`,
   `@earendil-works/pi-tui/dist/components/markdown.js`. Record decisions in DESIGN.md.
5. **Visual pass.** Only for the surfaces that changed, per DESIGN.md §9
   (pending/streaming/settled/failed, narrow viewport, mouse + Ctrl+O expansion).
6. **Close out.** Bump `AUDITED_PI_VERSION` to the running version, update the
   DESIGN.md header and §10, then from `~/.pi/agent`:

   ```bash
   pnpm run lint && pnpm run type-check && pnpm exec oxfmt --write <touched .ts files>
   ```

   End by telling the user to `/reload`; the widget disappears on the next session.

## Limits

- The script checks class-level ABI only (runtime exports + prototype methods).
  Instance-level field drift (`host.text`, `contentContainer`, message shapes)
  surfaces at render time — that is what the visual pass is for.
- `patchPiComponent` and `invokePiMethod` throw their own "re-audit" errors at
  install/render time; a fresh error line in the session is an audit finding too.
