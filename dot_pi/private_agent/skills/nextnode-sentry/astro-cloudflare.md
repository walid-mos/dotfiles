# Astro on Cloudflare — Sentry mechanics

Extends the checklist in `SKILL.md`; only the Astro 7 + `@astrojs/cloudflare` v14
mechanics live here. Verified on nextnode-landing (astro 7.3.4, adapter 14.3.3,
@astrojs/sentry 10.75.2, wrangler 4.136.3).

## Install and register

```bash
pnpm add @sentry/astro @sentry/cloudflare
pnpm add -D wrangler@^4.136.3   # peer of @astrojs/cloudflare v14
pnpm add -D vite                # only to type a custom Vite plugin (see below)
```

```ts
// astro.config.ts
import sentry from '@sentry/astro'

integrations: [
	sentry({
		org: process.env.SENTRY_ORG,
		project: process.env.SENTRY_PROJECT,
		authToken: process.env.SENTRY_AUTH_TOKEN,
	}),
]
```

Never pass `enabled: Boolean(process.env.SENTRY_AUTH_TOKEN)` to gate the upload: the
integration reads `enabled` as "enable the SDK" for both client and server, so a
missing token silently disables all error capture. The upload skips itself (with a
warning) when `authToken` is absent.

Known oxlint false positive: `import/default` on `@sentry/astro` although the `.d.ts`
declares the default export. Suppress inline with a one-line comment.

## The worker wrap: the only Astro 7 gap (getsentry/sentry-javascript#21901)

Sentry supports Astro 7 natively — the SDK peer dep is `astro >=3.x || >=7.0.0-beta`
and upstream issue #21500 is closed "fully compatible", with a dedicated `astro-7`
e2e app. Do not treat Astro 7 as unsupported and never replace the integration with
a hand-rolled setup.

The gap is narrow and specific. The SDK's `sentryCloudflareVitePlugin` transforms the
Astro virtual entry id `\0@astrojs-ssr-virtual-entry` (Astro ≤5 / adapter v12). Astro 7 + adapter v14 build
the worker from `\0virtual:cloudflare/worker-entry`, so the transform never matches:
`withSentry` is never applied and `sentry.server.config.ts` is never injected (the
`page-ssr` injection does not reach the worker entry either — do not create that file). Tracked upstream as
[getsentry/sentry-javascript#21901](https://github.com/getsentry/sentry-javascript/issues/21901)
(open as of 2026-07).

**The only accepted pattern is the in-config wrap below.** Never work around it by
creating a standalone Sentry worker entry (a custom `.mjs` entrypoint, or pointing
wrangler's `main` at a Sentry file): it replaces the app's own entry, duplicates
Sentry wiring outside `astro.config.ts`, and breaks on the next SDK update. When
upstream ships the fix (transform also matching `virtual:cloudflare/worker-entry`),
delete the local wrap plugin — re-check #21901 before wiring Sentry on this stack.

Until upstream supports the v14 entry id, wrap it in the app's own Vite plugin,
registered in `astro.config.ts` after Tailwind:

- `enforce: 'post'`, `transform(code, id)` matching `id.startsWith('\0virtual:cloudflare/worker-entry')`;
- replace `/export\s+default\s+([^;]+);/` with `export default withSentry(buildSentryOptions, <expr>);`
  (the emitted code is `export default mod.default ?? {};`);
- prepend `import { withSentry } from '@sentry/cloudflare';` and the options import by
  **absolute path** (`fileURLToPath(new URL('./sentry.worker.options.ts', import.meta.url))`) —
  a virtual module has no parent directory, so a relative import fails to resolve.

`sentry.worker.options.ts` exports `buildSentryOptions(env: CloudflareEnv)`, returning
dsn/environment/release/tracesSampleRate/sendDefaultPii. `withSentry` calls it per
request, which is the only worker-side init path on this stack — never read
`process.env` for the DSN (worker env bindings are not merged into `process.env` at
module scope).

Evidence the wrap landed: `withSentry` appears in `dist/server/entry.mjs` (the built
worker), and a deliberately throwing endpoint produces an issue in the Sentry project.

## Runtime env access (adapter v13+)

`Astro.locals.runtime` no longer exists. Read the worker env from the module:

```ts
import { env } from 'cloudflare:workers'
const { RESEND_API_KEY } = env
```

Type it once in `src/env.d.ts` with a global `interface CloudflareEnv` (worker secrets
declared in `nextnode.toml [deploy].secrets`) plus `declare module 'cloudflare:workers' { export const env: CloudflareEnv }`.
The same global interface types `buildSentryOptions`. Existing tests that stubbed
`locals.runtime.env` must `vi.mock('cloudflare:workers', () => ({ env }))` instead.

## Adapter v14 config changes

- `platformProxy` is gone: v14 runs `astro dev` under workerd through
  `@cloudflare/vite-plugin`.
- `imageService` default changed to `cloudflare-binding`; set `imageService: 'compile'`
  explicitly to keep build-time image optimization.
- Output layout: `dist/server/entry.mjs` (worker) + `dist/client/` (assets). The
  NextNode workers target derives the assets directory from the entry, binds `ASSETS`
  and injects `nodejs_compat` — `nextnode.toml` only needs
  `type = "app"`, `target = "cloudflare-workers"` and `[deploy.services.web] entry = "dist/server/entry.mjs"`.
- Sessions: the adapter always emits a `SESSION` KV binding line. Without a KV
  namespace in the infra-generated config the binding is absent, and
  `injectSessionBinding` is a no-op — only routes that actually use sessions would fail.

## Vitest stalls on the adapter plugin

The shared `@nextnode-solutions/standards/vitest/astro` preset loads the full Astro
config, so `@astrojs/cloudflare`'s Vite plugin validates the `ssr.resolve.external`
list `@sentry/astro` injects and aborts startup ("environment options are
incompatible with the Cloudflare Vite plugin"). Keep the preset and filter the
Cloudflare plugins out for tests: export a config function, await the preset, and drop
every plugin whose name starts with `vite-plugin-cloudflare` or `@astrojs/cloudflare`.

## Local runtime verification

`astro preview` is unsupported by the adapter. Build, then run the built worker:

```bash
wrangler dev --config /tmp/smoke-wrangler.jsonc --port 8788 --ip 127.0.0.1
```

with `main` and `assets.directory` as **absolute paths** (a config in `/tmp` resolves
relative paths against its own directory), `compatibility_flags: ["nodejs_compat"]`,
`assets.binding: "ASSETS"`, and the Sentry vars under `vars`. Then check the routes
(`/`, `/contact` → 302, `POST /api/contact`) and, for error capture, query the project
issues API. `GET`/`POST /api/…` handlers that catch their own errors never reach
Sentry; an error thrown in a route handler does.
