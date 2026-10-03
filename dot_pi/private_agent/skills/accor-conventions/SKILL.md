---
name: accor-conventions
description: >-
    Mandatory client rules for accor-hotels/product-data-apps (@astore/*: api,
    menu-compliance, ui; apps/portail, product-benchmark): git naming,
    untouchable perimeter (Terraform, product-benchmark), Clean Architecture +
    CQRS on the api, Feature-Sliced Design on the fronts, Snowflake data-mart
    auth, Jira ticket lookup via the official Atlassian MCP; Confluence specs
    require REST (currently blocked by the stale authFetch profile), quality
    baseline. Load when any file of product-data-apps or a product-data-apps*
    worktree is touched (branch, commit, PR, code) or before creating a
    branch/PR there. Also load for fastpocing-worker or astore-ui-sidebar when
    applying the shared Terraform, Jira, commit, or Confluence rules; do not
    load solely because a path contains "accor".
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
  (e.g. `feat/pre-push-ai-review`). `DA-*` ids are **Jira** tickets.
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

**PR bodies — Fast POCing task references**: never write a bare `#NN` for a
FastPOCing task — GitHub auto-links it to a PR/issue. Link the task page
instead: `[task NN](https://fast-po-cing-dashboard.vercel.app/tasks/<task-id>)`;
task ids come from the Jira comments or the FastPOC widget API (§5). No task id
available: link the Jira ticket, plain text otherwise.

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
  **only within the ticket's scope**; inspect the source repo and reimplement
  its logic while preserving its markup, CSS and assets where they already
  match — never copy the code wholesale. Visual parity is proven with a
  fail-closed zero-changed-pixel gate. Full contract (asset retrieval, 1:1
  fidelity, coverage manifest, pixel gate, and the hard limits of proto
  authority: never derive a schema or a business decision from it):
  `~/.pi/agent/skills/accor-ship/proto-authority.md`.
  For a Menu Compliance UI feature, including a dev/test widget or a change to one, load `accor-ship` and reconcile the prototype with numbered acceptance criteria **before editing code**.
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
  the main checkout keeps `astore`. Create the branch database through the repo's PostgreSQL
  administration flow, then set its `DATABASE_URL` in that worktree's gitignored `apps/api/.env`
  before migrating. If the repo has no documented database-creation command, verify the
  configured connection and ask before creating a database; do not use a nonexistent helper.
- **Closing a branch**: identify the database associated with that worktree before removing it.
  Drop it only with explicit approval after verifying it belongs to that branch; never sweep
  databases by name alone.
- **i18n**: one catalog `shared/i18n/locales/*.json`, one lookup `t()`. Every key
  added in `fr.json` **and** `en.json`.
- **Zero narrative comments.** One line max, only a constraint/invariant the code
  cannot express. Never paraphrase the code or address the reviewer.
- No `as` (except `as const`); validate and narrow instead.

## 5. Jira via MCP ; spécifications Confluence via REST

Le serveur MCP `jira` dans `~/.pi/agent/mcp.json` dispose d'une autorisation
Atlassian. Il permet de lire les **tickets Jira** sans mot de passe navigateur.
L'ancien profil `fetch_content(auth: "accor")` importe des cookies Brave
impossibles à déchiffrer ici : ne le réessaie pas et ne copie pas le profil
Brave personnel. Le coffre web Pi–Hermes ne fournit **ni cookie REST ni token
API**. Le projet `core-vault` du MCP `infisical` est distinct du coffre web
commun ; n'y cherche pas de mot de passe Atlassian. Voir
`/Users/walid-mos/Development/tools/pi-frontend-check/skills/shared-web-logins/SKILL.md`
pour les connexions navigateur.

### Lire un ticket Jira

Extrais la clé de l'URL, par exemple `DA-176` dans
`https://accor-eprocurement-support.atlassian.net/browse/DA-176`.
Avec l'outil `mcp`, découvre les outils du serveur `jira`, puis appelle
`jira_getAccessibleAtlassianResources` pour trouver **ce site précis** et
`jira_getJiraIssue` avec son identifiant de ressource et la clé du ticket.
Vérifie le ticket retourné ; si l'OAuth est expiré ou l'accès refusé, arrête-toi
et demande à l'utilisateur de renouveler l'autorisation. Si le MCP échoue sur
`Failed to write OAuth credentials to OS secure credential store`, **ne teste
pas le trousseau avec `security add-generic-password` ou `find-generic-password`**,
ne relance pas `auth-start` en boucle et ne cherche pas de secrets dans
Infisical : ferme cette session Pi, vérifie une lecture Jira seule dans un
nouveau processus Pi et signale séparément l'échec du stockage OAuth si elle
échoue encore. Ne remplace pas une réponse structurée absente par le HTML
d'une SPA.

### Lire une page Confluence

Dans `accor-hotels/product-data-apps`, la règle locale
`/Users/walid-mos/Development/clients/accor/AGENTS.md` et la Phase 0 de
`accor-ship` exigent que **chaque page de spécification liée au ticket soit
entièrement lue via l'API REST Confluence avec le profil `accor`**. Le MCP
Atlassian peut confirmer qu'une page existe, mais son corps peut être tronqué ;
il ne remplace pas la lecture REST faisant autorité. Extrais l'identifiant
numérique après `/pages/` et lis
`/wiki/api/v2/pages/{PAGE_ID}?body-format=atlas_doc_format` lorsque le profil
REST aura été réauthentifié par une méthode indépendante de Brave. Pour
l'instant, l'erreur de déchiffrement des cookies **bloque la lecture des specs
et donc la livraison** : signale-la, n'invente pas le contenu et ne substitue
ni ticket, ni MCP tronqué, ni HTML de SPA. Un accès REST de remplacement
nécessite une autorisation valide encore à mettre en place.

### Ticket screenshots / media

Les pièces jointes Jira peuvent être protégées par une redirection : si le
serveur Atlassian ne fournit pas le média, **ne relance pas** l'ancien
`authFetch`. Va plutôt sur **FastPOC** (dashboard des tâches de l'équipe,
`https://fast-po-cing-dashboard.vercel.app`) instead: its widget API
`GET /api/my-requests?email=<author>&project=<project key>` (e.g. project key
`iaft_pk_041dc2c0c07aa05c8a11efb6348e01bb`, author
`alexandre.corroy@consulting-for.accor.com`) lists tasks and can carry the
media; the dashboard UI itself needs an email-code login. If the screenshot is
not reachable there either, say so and proceed from the ticket's text.

## 6. Related skills

- `accor-debug` — reproduce and fix batches of 3+ product-data-apps bugs with parallel investigation and one grouped browser pass: `~/.pi/agent/skills/accor-debug/SKILL.md`.
- `accor-ship` — deliver a Menu Compliance feature (stack, proto fidelity, acceptance matrix): `~/.pi/agent/skills/accor-ship/SKILL.md`.
- `accor-comment` — format and post a charter-compliant review comment inline: `~/.pi/agent/skills/accor-comment/SKILL.md`.
- `accor-triage` — triage review comments received on my PRs: `~/.pi/agent/skills/accor-triage/SKILL.md`.
- `accor-announce` — Teams announcement message for PRs under review: `~/.pi/agent/skills/accor-announce/SKILL.md`.
- `accor-wording-audit` — FR/EN wording drift audit vs the proto: `~/.pi/agent/skills/accor-wording-audit/SKILL.md`.
