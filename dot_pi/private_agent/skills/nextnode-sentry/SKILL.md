---
name: nextnode-sentry
description: "Wire a NextNode project to the org's Sentry (sentry.io org `nextnode`), end to end and unattended: detect the stack, find or create the project via API, install and wire the SDK, set secrets, verify with a real source-map upload, commit a PR. Invoke the moment a request in a NextNode repo mentions Sentry ('intègre Sentry', 'hook ce repo à Sentry', CI warnings 'No org provided'/'Will not upload source maps') — start executing immediately in the cwd's git project; do not ask which steps to run. NOT for reading Sentry dashboards or fixing specific error events."
---

# Sentry onboarding — NextNode projects

One request ("intègre Sentry ici") = one full run of this checklist in the cwd's git
repo. Execute it top to bottom without asking for scope; every step auto-detects its
inputs and picks a defensible default. Ask a question only on a real blocker (no
`SENTRY_AUTH_TOKEN`, no git remote, Sentry API unreachable), via `ask_user_question`.
Declare a `goal` checklist mirroring steps 0–6 before starting; tick each with evidence.

## Facts (do not re-derive)

- Sentry org: `nextnode` (sentry.io).
- GitHub org secrets already exist on `NextNodeSolutions` (visibility: all repos):
  `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`. Never set them again, never print the token.
- The token lives in the local env as `SENTRY_AUTH_TOKEN`; it powers both the Sentry
  REST API (project creation, verification) and the build-time source-map upload.
- Repo-level secrets are one-shot per repo, never per PR: `SENTRY_PROJECT`
  (org-scoped slug) and `PUBLIC_SENTRY_DSN` (browser DSN — public by design).

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

## Step 3 — Set the secrets (one-shot per repo)

```bash
gh secret set SENTRY_PROJECT --body "<slug>"
gh secret set PUBLIC_SENTRY_DSN --body "<dsn>"   # only for a browser stack
```

Server-side DSN goes to the runtime env, not GitHub: for NextNode deploys add
`SENTRY_DSN` to `nextnode.toml` `[deploy].secrets`.

## Step 4 — Verify end-to-end (the only accepted proof)

- `pnpm build` (or the stack's build) with `SENTRY_ORG=nextnode
  SENTRY_PROJECT=<slug> PUBLIC_SENTRY_DSN=<dsn>` in env → log must show
  `> Uploaded files to Sentry`.
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
