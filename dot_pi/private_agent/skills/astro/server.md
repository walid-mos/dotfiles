# Astro server - request pipeline, caching, middleware, actions, sessions, env

Extends RULE 5 and RULE 7 of `SKILL.md`; the core rules are not restated here.

## Advanced routing: `src/fetch.ts` (v7)

`src/fetch.ts` (or `.js`) is a reserved entrypoint giving full control of Astro's request pipeline via the standard `fetch` handler pattern (Cloudflare Workers / Deno / Bun). Without it, Astro behaves as before.

```ts
import { astro, FetchState } from 'astro/fetch';

export default {
  fetch(request: Request) {
    const state = new FetchState(request);
    if (state.url.pathname.startsWith('/api')) {
      const url = new URL(state.url.pathname + state.url.search, 'https://backend-api.example.com');
      return fetch(new Request(url, request));
    }
    return astro(state); // fallback to Astro pages/endpoints
  },
};
```

- Hono composition: `import { astro } from 'astro/hono'` and `app.use(astro())` as the last middleware; individual Astro features compose as separate Hono middleware in explicit order: `i18n()`, then your auth, then `actions()`, `middleware()`, then custom timing, then `pages()` — auth before `actions()` is the pipeline order that old single-file middleware could not express.
- Config: `fetchFile: './src/router.ts'` points to another file; `fetchFile: null` disables advanced routing.
- Docs: https://docs.astro.build/en/guides/routing/ (Advanced Routing section).

## Route caching (v7 stable)

Platform-agnostic caching: set directives in routes, Astro translates them per provider.

```ts
// astro.config — top level, NOT inside experimental (v7)
import { defineConfig, memoryCache } from 'astro/config';
export default defineConfig({
  cache: { provider: memoryCache() },
  routeRules: { '/blog/[...path]': { maxAge: 300, swr: 60 } },
});
```

```astro
---
Astro.cache.set({
  maxAge: 120,           // seconds
  swr: 60,               // stale-while-revalidate window
  tags: ['products'],    // for targeted invalidation
});
---
```

- API routes and middleware use `context.cache` with the same shape. Invalidate on demand: `await cache.invalidate({ tags: ['products'] })` or `cache.invalidate({ path: '/products/x' })` — e.g. from a CMS webhook endpoint.
- Live content collections: a live loader can attach a cache hint (tags + last-modified) to returned entries; passing that entry to `Astro.cache.set(entry)` applies it without manual headers.
- CDN providers (experimental in 7.x, opt-in): `cacheNetlify()` from `@astrojs/netlify/cache`, `cacheVercel()` from `@astrojs/vercel/cache`, `cacheCloudflare()` from `@astrojs/cloudflare/cache`. Same APIs; directives become the platform's cache-control/purge operations, cache hits served at the edge without invoking the server.
- Docs: https://docs.astro.build/en/guides/caching/

## Middleware: `src/middleware.ts`

- Exports `onRequest(context, next)` (or an array `onRequest` for chained sequence). Call `next()` and return its response; mutate `context.locals` to pass per-request data to pages and endpoints.
- Order vs. Astro features: plain middleware does not run before Actions by default. If ordering matters (auth before actions, timing around only page rendering), move to advanced routing ([server.md](server.md) section above) where each feature is an explicit middleware.
- Docs: https://docs.astro.build/en/guides/middleware/

## Actions (form mutations)

- Define in `src/actions/index.ts` with `defineAction({ input: <schema>, handler })`; schemas are zod-validated, giving typed input on the server.
- Call from the client via `astro:actions` (typed RPC) or from a plain HTML form `action={actions.x}` for progressive enhancement without JS.
- Prefer Actions over hand-rolled `POST` endpoints for form flows: validation, typed errors, and CSRF handling come from the framework.
- Docs: https://docs.astro.build/en/guides/actions/

## Sessions

- Server-side session storage via the `session` config (driver per deployment target) and `Astro.session` in pages/endpoints/middleware.
- On serverless/edge hosts with no storage backing, disable explicitly with `session: false` (7.2+) rather than leaving a half-configured driver.
- Docs: https://docs.astro.build/en/guides/sessions/

## Environment variables: `astro:env`

- Declare in `env.schema` of `astro.config`: `{ env: { schema: { API_KEY: { type: 'string', context: 'server', access: 'secret' } } } }` — gives typed, validated imports from `astro:env/server` and `astro:env/client`.
- `context: 'client'` values are inlined into client bundles: never mark a secret as client-accessible; use `context: 'server', access: 'secret'` and reach it only in server code.
- Docs: https://docs.astro.build/en/guides/environment-variables/
