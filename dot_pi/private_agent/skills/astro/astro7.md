# Astro 7 - Defaults, breaking changes, minor releases, upgrades

Extends RULE 0 of `SKILL.md`; the core rules are not restated here. This file is the single home for Astro 7 release mechanics. Sources listed at the bottom.

Astro 7.0 released 22 June 2026. Latest patch verified on npm: **7.3.5** (24 Sept 2026). Adapters are versioned independently: `@astrojs/cloudflare` 14.3.x, `@astrojs/react` 7.0.x.

## v7.0 - what is now default

- **Rust compiler** (Go compiler removed; built on oxc + Lightning CSS). Strict: unclosed non-void tags are errors; invalid HTML is no longer auto-corrected or reordered; JSX whitespace handling. Cosmetic CSS output differences possible (named colors → hex, `url()` quoting) — only matters for exact-string snapshot tests.
- **Vite 8 with Rolldown**: one Rust bundler replacing esbuild + Rollup. Existing `rollupOptions`/esbuild config auto-converts via compat layer; custom Vite plugins mostly keep working. Check the Vite 8 migration guide only for integrations depending on Vite internals.
- **Sätteri** is the default Markdown/MDX processor (Rust, `pulldown-cmark` + oxc). GFM, smart punctuation, heading IDs, directives, math, frontmatter, wikilinks are built in; non-defaults enabled via `markdown.processor: satteri({ features: { directive: true, math: true, ... } })` from `@astrojs/markdown-satteri`. `@astrojs/markdown-remark` is no longer installed by default: install it and set `markdown: { processor: unified() }` to keep remark/rehype plugins.
- **Queued rendering** (experimental since 6.0): stable, default, no flag.
- **Route caching** stable; **advanced routing** enabled by default; **new logger** stable (top-level `logger` field).

## v7.0 - breaking changes checklist

1. **Remove stabilized experimental flags**: `experimental.logger`, `experimental.queuedRendering`, `experimental.rustCompiler`, `experimental.advancedRouting`, `experimental.cache`, `experimental.routeRules` — all removed from the config. `cache` and `routeRules` move to the top level.
2. **Strict markup**: fix unclosed tags (now build errors) and invalid nesting (rendered output changes instead of silent correction). Build and diff HTML output after upgrading.
3. **`compressHTML: 'jsx'` default**: spaces between inline elements disappear. Add `{' '}` between inline elements or set `compressHTML: true` for the v6 behavior.
4. **Reserved `src/fetch.ts`**: an existing file with that name is now treated as an advanced-routing entrypoint. Rename it, or set `fetchFile: './src/router.ts'` / `fetchFile: null`.
5. **Markdown plugins**: remark/rehype options still work but require `@astrojs/markdown-remark` installed and `processor: unified()`.
6. **Removed `@astrojs/db`**: replace with `node:sqlite` (Node ≥ 22.5), Drizzle directly, or the platform's database (Turso, PlanetScale, Neon).
7. **Removed `astro:transitions` internals**: `TRANSITION_BEFORE_PREPARATION`, `TRANSITION_AFTER_PREPARATION`, `TRANSITION_BEFORE_SWAP`, `TRANSITION_AFTER_SWAP`, `TRANSITION_PAGE_LOAD`, `isTransitionBeforePreparationEvent()`, `isTransitionBeforeSwapEvent()`, `createAnimationScope()`. Compare `event.type` against lifecycle event name strings instead.
8. **Deprecated `getContainerRenderer()` from package roots**: import from `@astrojs/react/container-renderer` (same entrypoint for preact, solid-js, svelte, vue, mdx).

## 7.1 (16 July 2026) - control

- CSP: `security.csp` directives support `kind` for element/attribute-level directives (`script-src-elem`, `script-src-attr`, `style-src-elem`, `style-src-attr`) — e.g. allow inline style attributes without inline `<style>` blocks.
- `paginate()`: `format` function for custom pagination URLs on hosts without URL rewrites.
- `astro dev --ignore-lock`: start a second dev server beside a running one.
- `deferRender`: lower memory when building large content collections. Chunked content storage still experimental.

## 7.2 (6 Aug 2026) - experimental incremental builds

- `experimental: { incrementalBuild: true }`: unchanged pages are reused from the previous build. Each page needs a `cacheKey` in `getStaticPaths()`; collection entries expose a `digest` field usable as that key.
- Cache lives in `node_modules/.astro/` — preserve it between CI runs or incremental builds never help.
- Cache invalidation: a middleware change does **not** invalidate; a config or dependency change invalidates everything. Use the latest 7.3.x patch (fixes for stale CSS and `build.concurrency > 1` landed between 7.2.5 and 7.3.4).
- `session: false` in config: disables sessions entirely — useful on serverless/edge where the session driver has no storage.
- `astro preview --background`: background mode for the preview server (same mechanics as dev, below).

## 7.3 (3 Sept 2026) - preview servers, Cloudflare

- `astro preview --ignore-lock`: multiple preview servers side by side (e.g. parallel Playwright runs).
- Logger available to custom image services and cache providers.
- `@astrojs/cloudflare` ≥ 14.3: `finalize()` helper for custom worker entrypoints.

## Agent workflow: background dev server and JSON logging (v7.0)

- `astro dev --background`: starts a managed background server, blocks until ready, prints URL + pid, then detaches. `astro dev stop` / `astro dev status` / `astro dev logs` manage it; every command is idempotent (starting twice returns the existing instance, stopping when stopped succeeds silently). A lockfile prevents duplicates; `--ignore-lock` overrides it.
- Astro auto-detects AI coding agents and enables background mode + JSON logs with no flag.
- Health check: every running dev server exposes `/_astro/status`.
- JSON logging: `astro dev --json`, or `logger: logHandlers.json()` / `logHandlers.compose(logHandlers.console(), logHandlers.json())` in config.

## Upgrade procedure

```bash
npx @astrojs/upgrade   # upgrades astro AND official integrations together
```

- Always bump adapters in the same upgrade as `astro`. A compatible-looking pair (adapter peer `astro ^7.2.0` with astro 7.3.5) can still fail at build (`MISSING_EXPORT "beginContentEntryCollection"` seen with `@astrojs/cloudflare` 14.2.5 on astro 7.3.5); adapter 14.3.x fixed it.
- Upgrade in a separate branch; run a full build and inspect rendered HTML for the strict-markup and whitespace regressions above.
- Patch-level behavior changes to know: since 7.1.2 cookie values are no longer percent-encoded; since 7.3.2 `<script>{value}</script>` is escaped in MDX.

## Sources

- Announcement: https://astro.build/blog/astro-7/
- Upgrade guide: https://docs.astro.build/en/guides/upgrade-to/v7/
- Route caching guide: https://docs.astro.build/en/guides/caching/
- AI guide: https://docs.astro.build/en/guides/build-with-ai/
- Sätteri: https://satteri.bruits.org/
- 7.0→7.3 panorama (third-party, measured): https://astrobuild.eu/en/blog/astro-7-whats-new
- Version check (re-run before relying on "latest"): `npm view astro version`
