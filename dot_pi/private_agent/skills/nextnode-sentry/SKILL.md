---
name: nextnode-sentry
description: "Wire a NextNode project to the org's Sentry (sentry.io org `nextnode`), end to end and unattended: detect the stack, find or create the project via API, install and wire the SDK, set secrets, verify with a real source-map upload, commit a PR. Invoke when a request in a NextNode repo ASKS to wire/integrate/fix Sentry ('intègre Sentry', 'hook ce repo à Sentry', fix the CI warnings 'No org provided'/'Will not upload source maps') — start executing immediately in the cwd's git project; do not ask which steps to run. A merely informational Sentry mention (reading dashboards, triaging a specific error event, referencing existing Sentry config) is NOT authorization to create projects or write secrets. NOT for reading Sentry dashboards or fixing specific error events."
---

# Sentry onboarding — NextNode projects

One request ("intègre Sentry ici") = one full run of this checklist in the cwd's git
repo. Execute it top to bottom without asking for scope; every step auto-detects its
inputs and picks a defensible default. Ask a question only on a real blocker (no
`SENTRY_AUTH_TOKEN`, no git remote, Sentry API unreachable), via `ask_user_question`.
Execute steps 0–6 in order and close each with its evidence before moving on.

## Facts (do not re-derive)

- Sentry org: `nextnode` (sentry.io).
- Obtain `SENTRY_AUTH_TOKEN` through an authorized secure process for Sentry API
  calls or local uploads. Never print it or request its value in chat.
- `SENTRY_ORG`, `SENTRY_PROJECT` and DSNs are public settings. An upload token is
  a build-only credential, not a Worker secret. Follow the Infisical workflow in
  step 3 for placement and supported consumers.

## Step 0 — Detect the project and the stack

- Project = `git rev-parse --show-toplevel` from cwd; repo name = the GitHub repo
  (`gh repo view --json name -q .name`). Everything below keys off that name.
- Detect the stack from `package.json` + config, then apply row of the table:

| Stack signature                                   | SDK                                   | Platform slug (API)        | Doc to load                          |
| ------------------------------------------------- | ------------------------------------- | -------------------------- | ------------------------------------ |
| `@astrojs/cloudflare` adapter                     | `@sentry/astro` + `@sentry/cloudflare`| `javascript-astro`         | [astro-cloudflare.md](astro-cloudflare.md) |
| `astro` with another adapter                      | `@sentry/astro`                       | `javascript-astro`         | https://docs.sentry.io/platforms/javascript/guides/astro/ |
| `next` / Next.js app                              | `@sentry/nextjs`                      | `javascript-nextjs`        | https://docs.sentry.io/platforms/javascript/guides/nextjs/ |
| Cloudflare Worker (`wrangler.toml`/`wrangler.jsonc`, no Astro) | `@sentry/cloudflare`      | `javascript-cloudflare`    | https://docs.sentry.io/platforms/javascript/guides/cloudflare/ |
| Node API (express/fastify/hono/node, none of the above) | `@sentry/node`                  | `javascript-node`          | https://docs.sentry.io/platforms/node/ |

- Never guess an SDK name outside this table; if the repo matches no row, stop and ask.

## Step 1 — Find or create the Sentry project (org `nextnode`)

```bash
curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  "https://sentry.io/api/0/organizations/nextnode/projects/" | jq '[.[] | {slug, platform}]'
```

- A slug exactly equal to the repo name → reuse it. A slug equal to the repo name with
  a different platform → reuse it too (projects are not platform-locked).
- No match → create it (slug = repo name, platform from the table) and continue — this
  is a reversible default, do not ask:
  ```bash
  curl -s -X POST -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"<repo>","slug":"<repo>","platform":"<platform>"}' \
    "https://sentry.io/api/0/organizations/nextnode/projects/"
  ```
- Fetch the DSN from the keys endpoint:
  `https://sentry.io/api/0/projects/nextnode/<slug>/keys/` → `.default.dsn.public`
  (or the first key's `dsn.public`).

## Step 2 — Wire the SDK

Follow the doc for the row from step 0. Defaults, decided once here — do not re-litigate:

- Errors only: `tracesSampleRate: 0`, no session replay, `sendDefaultPii: false`.
- DSN from env, never hardcoded; every init no-ops when its DSN env var is absent so
  local dev stays silent.
- Browser stack (Astro, Next.js) → client DSN = `PUBLIC_SENTRY_DSN`; server/worker DSN
  = `SENTRY_DSN`. Node API → `SENTRY_DSN` only.

## Step 3 — Configure the environment

Run "Project secret workflow" in
`~/.pi/agent/skills/nextnode-deploy/github-org.md`. Reconcile actual SDK consumers,
not a preset list of Sentry secret names. Keep upload credentials out of the
application's Worker environment. Configure public settings through the supported
runtime or build input, never GitHub secrets or removed TOML secret declarations.

Read "Build-time values" in
`~/.pi/agent/skills/nextnode-deploy/deploy-env.md` before configuring CI uploads or
browser DSNs. The current reusable deploy build cannot receive an upload token or
public build inputs. Report that gap and the exact affected consumer. A local
upload does not complete CI integration. Do not grant the caller build vault access
to work around it.

## Step 4 — Verify end-to-end (the only accepted proof)

- For an authorized local upload, run the stack's build with its required public
  settings and securely injected upload token. Confirm `Uploaded files to Sentry`
  without printing credentials. Report this as local evidence, separate from CI.
- Verify the actual CI input path before claiming source-map uploads or browser
  configuration work there. If step 3 found an unsupported input, keep it blocked.
- Confirm the release exists, version = git sha:
  ```bash
  curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
    "https://sentry.io/api/0/projects/nextnode/<slug>/releases/" | jq '[.[] | .version]'
  ```
- Worker/server stacks: run the built artifact against a real throw and confirm an
  issue appears in the project (see the stack doc).
- Neutral build without credentials still passes (gating must not break CI).
- `pnpm lint` + `pnpm type-check` clean (pre-existing failures untouched).

## Step 5 — Commit

Dedicated branch; PR body lists every surface touched and the verification evidence.

## Guardrails

- Never commit any DSN or token value; they live in secrets/env only. `.env.example`
  gets empty placeholders documenting each variable (build-time vs browser vs runtime).
- Server-side `Sentry.init` must read env vars, never hardcode the DSN.
- Do not enable session replay or high sample rates on client bundles by default; a
  landing page ships errors-only tracing (`tracesSampleRate: 0`) unless asked.
- Never create a standalone Sentry entry file (a `.mjs`, or wrangler's `main` pointed
  at a Sentry file) — it replaces the app's entry. Wire the worker wrap inside
  `astro.config.ts` as a Vite plugin instead (see the stack doc).

## Stack notes

- [astro-cloudflare.md](astro-cloudflare.md) — Astro 7 + `@astrojs/cloudflare` v14
  specifics (worker wrap workaround for upstream gap
  getsentry/sentry-javascript#21901, `cloudflare:workers` env access, workers deploy
  config, vitest plugin filter). Load it for any Astro project on Cloudflare.
