---
name: accor-conventions
description: >-
    Mandatory client rules for accor-hotels/product-data-apps (@astore/*: api,
    menu-compliance, ui; apps/portail, product-benchmark): git naming,
    untouchable perimeter (Terraform, product-benchmark), Clean Architecture +
    CQRS on the api, Feature-Sliced Design on the fronts, Snowflake data-mart
    auth, Jira/Confluence REST via the authFetch "accor" profile, quality
    baseline. Load when any file of product-data-apps or a product-data-apps*
    worktree is touched (branch, commit, PR, code) or before creating a
    branch/PR there — not for everything under an "accor" root.
---

# Accor conventions — mandatory, non-negotiable

Frozen context for client **Accor**, repo `accor-hotels/product-data-apps`
(monorepo `product-data-apps` and worktrees named `product-data-apps*`). These
rules are not optional and override defaults. The per-app agent docs inside the
repo (`apps/api/AGENTS.md`, `apps/*/AGENTS.md` or `CLAUDE.md`, `packages/*/`) are
the detailed local truth; this skill is the transverse private source. Other
Accor projects (`fastpocing-worker`, `astore-ui-sidebar`, …) have no dedicated
skill: only the shared critical rules apply to them — never Terraform (§2),
`DA-*` = Jira (§1), atomic commits per the project's own conventions, and §5
for Jira/Confluence.

## 1. Git naming — non-negotiable

**Branches**: `<type>/<TICKET?>-<kebab-desc>`.
- `<type>` ∈ `feat` `fix` `chore` `docs` `refactor` `test` (the dominant type of the diff).
- `<TICKET>` = the Jira id when the work has one (`DA-178`); **omitted** otherwise
  (e.g. `feat/pre-push-ai-review`). `DA-*` ids are **Jira** tickets, never
  Plane.
- Valid: `feat/DA-178-partners-api`, `refactor/auth-context-identity`, `fix/invoice-upload-timeout`.
- **Forbidden**: stack indexes in the name (`-01-`, `-02-`), unprefixed free names
  (`auth-rewire-02-server-authority`), `mc-partners-05-...`.

**PR titles**: Conventional Commit `<type>(scope): <description>`.
- With a ticket, the repo style is `<type>(scope): DA-xxx — <description>`
  (e.g. `feat(menu-compliance): DA-178 — partners CRUD view`).
- `<scope>` = touched zone: `api`, `menu-compliance`, `ui`, `benchmark`, `auth`, `hooks`.

**Commits**: Conventional Commits, same types/scopes. Atomic per the global
definition — all four criteria together, single-homed in `~/.pi/agent/AGENTS.md`
§ Git. Imperative message; explain the *why* when it is not obvious. Never a
catch-all or WIP commit.

**Base & flow**: branch from an up-to-date `develop`; open the PR **against
`develop`** (integration → deploys the *dev* env; `main` = *prod*, promotions only).

Stacks (chained PRs) are sliced by the stack contract — see `accor-ship`
(`~/.pi/agent/skills/accor-ship/stack-contract.md`); no thresholds or algorithm
here. Delivery order: `dev → per-link self-review → global self-review → submit`.

> ⚠️ **Renaming a branch on GitHub CLOSES its PRs** (the head ref is immutable;
> the old name disappears → GitHub closes the PR). Corollary: **name correctly at
> creation time**. A PR cannot be deleted on GitHub (only issues can) — a closed
> one stays in history. If a rename closed PRs, recreate the PRs on the new
> branches and leave `Superseded by #NN` on the old ones.

## 2. Perimeter — untouchable

- **NEVER Terraform / `infra/` / `*.tf`.** Under no pretext, not even "just a variable".
- **NEVER `apps/product-benchmark`** (nor `apps/portail`) unless explicitly requested.
- Menu Compliance working zone: `apps/api`, `apps/menu-compliance`, `packages/ui`
  and `packages/oxlint-config` only when a shared coupled change requires it.
  Any exit from this zone is flagged and justified **before** committing.

## 3. Architecture

- **`apps/api`**: Clean Architecture + DDD + CQRS + tRPC. Dependency direction
  `domains ← application ← infrastructure`, never the reverse. No cross-app
  imports. Boundaries enforced by `dependency-cruiser` (`pnpm lint`). Detail:
  `apps/api/AGENTS.md`.
- **Fronts** (`menu-compliance`, `portail`, `product-benchmark`): **Feature-Sliced
  Design**. Imports strictly downward
  (`pages → widgets → features → entities → shared`), never sideways or upward.
  Public API per slice (`index.ts`). Detail: `apps/menu-compliance/AGENTS.md`.
- **Proto invariant**: the deployed prototype is the visual and behavioral truth
  **only within the ticket's scope**; inspect the source repo and reimplement —
  never copy. Full contract (asset retrieval, 1:1 fidelity, and the hard limits
  of proto authority: never derive a schema or a business decision from it):
  `~/.pi/agent/skills/accor-ship/proto-authority.md`.
- **Auth**: SSO authenticates **identity only** (`{sub, email}`); `role` + `segment`
  come from the **Snowflake data mart**, never from the JWT nor the client; the
  whitelist (`whitelisted_emails`) is a **manual 403 guard** filled by SQL,
  **never** the source of the role. Detail: `apps/menu-compliance/AGENTS.md`
  and `apps/api/AGENTS.md`.

## 4. Baseline & commands

- **Real baseline before "done"**: `pnpm typecheck && pnpm lint && pnpm test`
  green — actual output, never assumed. The front reads types from the api
  *build*: `pnpm --filter @astore/api build` before typechecking a front.
- **Runbook**: package manager `pnpm` (workspace + turbo) — never `npm`/`yarn`.
  Dev: `pnpm dev:compliance` (starts `@astore/api` + the compliance front).
  Filter when needed: `--filter @astore/menu-compliance` / `--filter @astore/api`.
  Format: `pnpm format`. commitlint is active.
- **Dev infra first**: before `pnpm dev` (or any `dev:*`), check
  `docker compose ps`; when PostgreSQL/Keycloak/MinIO are not up, run
  `docker compose up -d`, wait for their health, then
  `pnpm --filter @astore/api db:migrate`. Never declare dev ready while the API
  logs PostgreSQL or MinIO connection errors.
- **Dev DB per branch**: one infra stack per machine (fixed host ports 5432/8080/9000 — never
  start a second stack). Branch isolation lives in the database name: `astore_<slug>` per worktree
  (slug = the Jira id when the worktree name carries one, else the directory name kebab→snake);
  the main checkout keeps `astore`. `astore-db new <worktree>`
  (`~/.pi/agent/skills/accor-conventions/scripts/astore-db`) creates it and prints the
  `DATABASE_URL` line for that worktree's gitignored `apps/api/.env`; `pnpm dev` then migrates
  that branch's DB. `astore-db name <worktree>` prints the name alone.
- **Closing a branch**: `astore-db drop <worktree>` **before** `git worktree remove` — otherwise
  the database outlives the worktree forever. Worktree already gone: `astore-db orphans` lists the
  leftovers, `astore-db orphans --drop` sweeps them.
- **i18n**: one catalog `shared/i18n/locales/*.json`, one lookup `t()`. Every key
  added in `fr.json` **and** `en.json`.
- **Zero narrative comments.** One line max, only a constraint/invariant the code
  cannot express. Never paraphrase the code or address the reviewer.
- No `as` (except `as const`); validate and narrow instead.

## 5. Jira / Confluence via REST

**Precondition**: an `authFetch` profile named `accor` is configured for
`accor-eprocurement-support.atlassian.net` (browser-cookie digest from the
local Chrome session). It is an auth profile — **never seek an MCP tool for
Jira/Confluence**. Verify the profile exists before the first REST call; if it
is missing, say so and stop the read — never fetch these pages as HTML
instead: they are SPAs whose useful content is loaded dynamically in JS. The
API REST is the only path.

### Read a Jira ticket

    URL example : https://accor-eprocurement-support.atlassian.net/browse/DA-176
    API         : GET /rest/api/3/issue/{TICKET_KEY}

Extract the ticket key (e.g. `DA-176`) from the URL into the REST endpoint:

    fetch_content(auth: "accor", url: "https://accor-eprocurement-support.atlassian.net/rest/api/3/issue/DA-176")

### Read a Confluence page

    URL example : https://accor-eprocurement-support.atlassian.net/wiki/spaces/MID/pages/2043871247/...
    API         : GET /wiki/api/v2/pages/{PAGE_ID}?body-format=atlas_doc_format

Extract the `PAGE_ID` (integer) from the Confluence URL (segment after `/pages/`):

    fetch_content(auth: "accor", url: "https://accor-eprocurement-support.atlassian.net/wiki/api/v2/pages/2043871247?body-format=atlas_doc_format")

`atlas_doc_format` returns structured ADF JSON. If the fetch is truncated
(30k-character limit), use `get_search_content` with the `responseId` and
`offset` to retrieve the rest.

## 6. Related skills

- `accor-ship` — deliver a Menu Compliance feature (stack, proto fidelity, acceptance matrix): `~/.pi/agent/skills/accor-ship/SKILL.md`.
- `accor-comment` — format and post a charter-compliant review comment inline: `~/.pi/agent/skills/accor-comment/SKILL.md`.
- `accor-triage` — triage review comments received on my PRs: `~/.pi/agent/skills/accor-triage/SKILL.md`.
- `accor-announce` — Teams announcement message for PRs under review: `~/.pi/agent/skills/accor-announce/SKILL.md`.
- `accor-wording-audit` — FR/EN wording drift audit vs the proto: `~/.pi/agent/skills/accor-wording-audit/SKILL.md`.
