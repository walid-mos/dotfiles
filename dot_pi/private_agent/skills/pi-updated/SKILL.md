---
name: pi-updated
description: Re-audit installed Pi after an upgrade or extension failure through changelog review, extension APIs, loader hygiene, every vendored package's real runtime paths, display ABI, visuals and audited dist patches. Use for the drift widget, missing-module or missing-member failures, package-shape or builtin-collision warnings, and when adding or changing a vendored Pi package or its compatibility checks.
---

# Pi update re-audit

This user-requested Pi maintenance is the narrow exception in `~/.pi/agent/AGENTS.md` under Third-party code. Inspect installed Pi dist sources and reapply only the audited dist patches. It does not permit patching other dependencies or incidental Pi internals.

`AUDITED_PI_VERSION` in `~/.pi/agent/extensions/lib/ui/pi-runtime.ts` records the release last reviewed. It is not proof that current packages work. Always run the compatibility gate, even when installed and audited versions match. Do not mark a release audited while a required operation failed, timed out, was skipped, or remains unverified.

## Procedure

1. **Running sessions.** From `~/.pi/agent`, run:

   ```bash
   node skills/pi-updated/scripts/stale-session-check.ts
   ```

   Every `✗` names a Pi process started before the installed release. Tell the user to exit and relaunch those sessions. `/reload` cannot replace Pi modules already in memory. A same-version reinstall can flag a healthy process, but restarting is safe. Disk audits do not verify these running processes.

2. **Changelog review.** Compare installed Pi with `AUDITED_PI_VERSION`. If versions differ, run:

   ```bash
   node skills/pi-updated/scripts/changelog-diff.ts
   ```

   Read every **Breaking Changes**, **Removed**, **Changed** and **Added** entry. Trace removed dependencies, exports, SDK behavior, loaders, hooks, tool execution, event dispatch, UI and rendering changes through `extensions/` and all vendored package sources. Search changed package names and subpaths in dynamic imports and dependency alias tables, not only static imports. A removed dependency must be either unused or exercised by a passing package audit after correction.

   If the audited changelog section is absent, use `npm pack @earendil-works/pi-coding-agent@<AUDITED_PI_VERSION>` and inspect its changelog. When versions match, skip only the empty changelog interval. Review relevant release entries again when investigating a failure the previous audit missed.

   Record each consequence and its check in `extensions/DESIGN.md` §10. Name-level checks cannot detect event-dispatch order or listener timing. For example, a listener registered during `session_start` can miss that dispatch without any API name changing.

3. **Compatibility gate.** Run:

   ```bash
   pnpm run audit:pi
   ```

   The command runs these checks in fresh processes, retains complete logs and exit evidence, and returns nonzero if any check fails. Read its report and failed logs. It runs all checks rather than stopping after the first finding.

   - `extension-audit.ts` scans production source under `extensions/` and every vendored package, excluding dependencies, generated output and tests. It checks used `pi.on`, registration and `ctx.ui` names against installed declarations.
   - `hygiene-audit.ts` checks settings-loaded and vendored package manifests against Pi's host-provided dependency set, checks replaceable builtin collisions, and runs Pi's real loader over the settings. Every loader warning or error fails. Disable a deliberately replaced builtin in settings or rename the extension registration.
   - `package-audit.ts` discovers every immediate directory under `packages/`, including disabled packages, and requires a runtime audit from each. It executes real package operations against installed Pi rather than development copies. Missing audit coverage fails instead of being silently omitted.
   - `abi-audit.ts` checks reflected runtime exports and patched component prototype methods. Update its `COMPONENT_METHODS` table if the adapters' actual patch targets changed.

   **Vendored package checks.** Read [package-audits.md](package-audits.md) before adding or modifying a package audit, or reviewing whether its delayed runtime paths are covered. That document owns the package contract and execution boundaries.

4. **Repair.** Fix each failure in the module that owns the integration, then rerun the gate. For display changes, fix the affected `*-surface.ts` adapter, not its callers. Preserve the display contract in `extensions/DESIGN.md` §2–§4. Follow `~/.pi/agent/skills/harness-tuning/SKILL.md` before any Pi source or dist change. Do not install a dependency Pi removed merely to satisfy an obsolete local check.

5. **Dist patches.** Read `scripts/SOURCE.md` and run every registered `pi-patch-*.py` reapply command. A Pi update replaces patched artifacts even when the other checks pass. Every result must be patched or already patched. A missing target is a finding, not a skipped patch. Maintain the registry when an explicitly approved patch changes.

6. **Display review.** Follow `extensions/DESIGN.md` §10 to compare the new tool renderers, interactive components and Pi TUI Markdown against the audited release. Record glyph, spacing and formatting decisions. Inspect changed surfaces in their pending, streaming, settled and failed states, including narrow widths and mouse/Ctrl+O expansion, per §9. Leave an unavailable visual check explicitly open.

7. **Close out.** After repairs and patches, rerun `pnpm run audit:pi`, then the lint, type-check and changed-file formatting gates required by `harness-tuning`. Only after all required results are verified may you update `AUDITED_PI_VERSION` and the DESIGN header. Record the report path and package runtime evidence in §10 without claiming unverified behavior works.

   Tell the user to `/reload` for changed extension code, or to fully restart sessions flagged in step 1. Do not replace a failed subagent protocol with direct work and call that verification.

## Limits

Static API and ABI checks prove names and signatures, not semantics. The live loader proves extension loading, not deferred work. Package audits prove the operations they execute, not every possible feature. Changelog tracing and the affected visual or real-flow checks remain required. A failure outside an audit's existing coverage requires extending the owning package audit before declaring that failure resolved for future upgrades.
