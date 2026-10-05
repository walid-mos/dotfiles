---
name: astro
user-invocable: false
description: >-
    Astro project judgment for Astro 7.x: zero-JS discipline, islands, strict
    markup, routing, content collections, server pipeline. MUST be loaded
    whenever creating or modifying any file in an Astro project (.astro
    components, astro.config, content collections, endpoints, middleware), and
    alongside the "react" and "typescript" skills when UI-framework islands are
    involved. Mechanical linting is owned by tooling; this skill covers what
    the linter cannot judge and the Astro 7 default changes that break v6
    assumptions.
---

# Astro - Mandatory Rules

References: [astro7.md](astro7.md) (v7 defaults, breaking changes, 7.1-7.3, upgrade checklist), [server.md](server.md) (request pipeline, caching, middleware, actions, sessions, env).

## RULE 0 - Know the version before assuming defaults (highest priority)

Baseline is **Astro 7.x** (7.3.5 as of Oct 2026). Astro 7 changed defaults that v6 code assumes:

- `compressHTML: 'jsx'` — JSX whitespace rules (see RULE 4).
- Strict Rust compiler — no HTML auto-correction (see RULE 4).
- Sätteri is the default Markdown processor; remark/rehype plugins need `@astrojs/markdown-remark`.
- Queued rendering, route caching, advanced routing, JSON logging are stable/default.

Verify before acting: `npm view astro version` and the project's `package.json`. Never write v6-era config (`experimental.rustCompiler`, `experimental.queuedRendering`, `experimental.cache`) — those flags are removed in v7 and their features are default.

## RULE 1 - Zero JS is the default, islands are the exception

- A `.astro` component ships no JavaScript. Reach for a framework island only when the behavior genuinely needs client state or interactivity.
- Framework components without a `client:*` directive render to static HTML and ship no JS — prefer that over premature hydration.
- When hydrating, choose the laziest directive that works: `client:visible` over `client:load`, `client:idle` over `client:load`. `client:only` only when the component breaks SSR (e.g. browser-only APIs).
- Composition of islands: push state down into one island; do not hydrate a large tree to update one widget.

## RULE 2 - Frontmatter is server-side, runs once

The `---` block is TypeScript executed once per render, at build (static) or request (SSR). There is no re-render, no state, no hooks.

- Type props with an explicit interface and read them from `Astro.props`.
- Fetch data directly (`fetch`, loader utils) — there is no data-fetching hook layer to reinvent.
- Framework state (signals, atoms, stores) belongs inside islands, never in `.astro` frontmatter.
- Anything that must run on every request in SSR belongs in middleware, not in each page.

## RULE 3 - Scripts: processed by default, inline on purpose

- `<script>` (no attributes) is bundled as a module, deduplicated, hoisted to the head, and runs once per page load. Use it for page behavior; import npm modules freely.
- `is:inline` is the escape hatch: raw output, not processed, not deduplicated, no imports/bundler features. Required for analytics snippets and inline JSON-LD with template expressions.
- `<script define:vars={...}>` is implicitly inline: raw, variables injected, no bundler processing. Do not try to import modules in it.
- Under view transitions, a script does not re-run on client-side navigation. Re-arm with `data-astro-rerun` or subscribe to `astro:page-load` instead of duplicating init logic.

## RULE 4 - Strict markup (Rust compiler) and JSX whitespace

The v7 compiler passes markup through as-is; the old silent fixes are gone.

- Close every non-void element. Unclosed tags (`<div>Hello`) are build errors. Void elements (`<br>`, `<img>`, `<input>`, `<hr>`) need no closing tag.
- Invalid nesting is not auto-corrected (`<div>` inside `<p>`): the browser closes the `<p>` early and the layout breaks silently. Fix the nesting, not the symptom.
- With `compressHTML: 'jsx'` (default), whitespace between elements follows JSX rules: newlines between inline elements render no space. Write `{' '}` (or `{" "}`) explicitly between inline elements that need a visible space, e.g. `<span>Hello</span>{' '}<span>World</span>`. Visual-check inline-element spacing after any markup refactor.

## RULE 5 - Routing and reserved file names

- File-based routing under `src/pages/`; dynamic segments `[param]`, rest `[...path]`; generate params in `getStaticPaths()` for static routes.
- `src/fetch.ts` (or `.js`) is a **reserved** file name (advanced routing, v7): Astro processes it as the request pipeline entrypoint. Never use it for anything else; disable or rename via the `fetchFile` config option (see [server.md](server.md)).
- `src/middleware.ts` is the other reserved entrypoint: on-request logic shared by routes (auth, logging, locals).
- Control rendering per route with `export const prerender = true | false` instead of switching the whole site's `output` mode when only some routes differ.

## RULE 6 - Data: content collections, typed

- Use content collections (`src/content.config.ts` with loaders) for local content and structured remote data; they give type-safe `getCollection()` / `getEntry()` and schema validation.
- Per-request remote data in SSR: a **live content collection** (live loader), not `getCollection` over snapshot data.
- For incremental builds (7.2+), static pages need a stable `cacheKey` in `getStaticPaths()`; collection entries expose `digest` for it. Mechanics: [astro7.md](astro7.md).

## RULE 7 - Env: typed, not process.env

Declare environment variables in the `env.schema` of `astro.config` (`astro:env`) to get typed access and validation. Reach for raw `process.env` / adapter-specific secrets only for values needed by server-only code outside the schema model. Secrets referenced by build-time code must be present at build time.

## RULE 8 - SOLID always, SRP first, one component per file

Every component (`.astro` page/section AND framework island) has exactly ONE job: ONE reason to change. A component that fetches AND transforms AND renders is split - data shaping lives in the frontmatter or a module, the template only renders. One component per file, always. The ONLY exception: a minimal private sub-component precisely scoped to its single consumer - co-located, never exported, never reused, kept as simple as possible (no size number; simplicity is the test). Own file the moment it grows its own state, a second caller, or a second reason to change.

Full SOLID-for-components mechanics with examples (S/O/I/D, god-component splits, imperative splits): `~/.pi/agent/skills/react/composition.md` - apply the same lines to Astro templates.

## Where depth lives

- [astro7.md](astro7.md) — load when upgrading Astro, bumping adapters, debugging "it built in v6 but not v7", or using v7 features (Sätteri, advanced routing, route caching, background dev server, incremental builds). Contains the full v7.0 breaking-change list, 7.1-7.3 additions, and the upgrade checklist.
- [server.md](server.md) — load when writing `src/fetch.ts`, `src/middleware.ts`, actions, sessions, API endpoints, or configuring caching (`Astro.cache`, `routeRules`, CDN providers) or `astro:env`.
- Load the `react` skill alongside this one whenever writing `.tsx`/`.jsx` island components; load `typescript` for shared logic.
