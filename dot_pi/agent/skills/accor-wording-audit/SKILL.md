---
name: accor-wording-audit
description: >-
    Exhaustive FR/EN wording audit of @astore/menu-compliance against the
    drinks-menu-compliance prototype (source of truth), via parallel subagent
    readers with adversarial verification. Use for "audit le wording", "check
    le drift de wording", "vérifie le wording contre le proto". NOT for general
    i18n plumbing or translation refactors.
---

# accor-wording-audit — wording drift vs the proto

Verify that every user-visible string in `apps/menu-compliance` (of the Accor
monorepo `product-data-apps`) is **strictly identical**, character for
character, to the wording of the prototype
[drinks-menu-compliance](https://github.com/VianneyBertrand/drinks-menu-compliance)
— the source of truth. FR **and** EN.

## Phase 0 — Setup (inline)

    git clone --depth 1 https://github.com/VianneyBertrand/drinks-menu-compliance /tmp/proto-accor-wording

- `APP=<repo>/apps/menu-compliance`
- `PROTO=/tmp/proto-accor-wording`
- Remove `/tmp/proto-accor-wording` at the end of the audit.

List the files per scope with `git ls-files` (APP) and `find` (PROTO). Embed
the **explicit sorted lists** in `UNITS`. Child readers never re-derive the
partition.

## Phase 1 — Deterministic checks (inline, no agent)

1. **fr/en key parity**:
   `diff <(jq -r 'paths(scalars)|join(".")' fr.json | sort) <(jq -r 'paths(scalars)|join(".")' en.json | sort)`
2. **Hardcoded FR strings outside the catalog**:
   `grep -rln "[éèêàçùûôîœ]" src --include="*.tsx" --include="*.ts" | grep -v test | grep -v i18n`
   → every hit outside `shared/i18n` must be justified or covered by a reader.

## Phase 2 — Fan-out (one reader child per unit)

Spawn one reader per `UNITS` key with the `subagent` tool (parallel where the
batch allows); the unit's file list and the reader task below are the ONLY
inputs the reader gets.

### Scopes (`UNITS` keys)

| Key | App scope (`apps/menu-compliance`) | Proto scope |
|---|---|---|
| `catalogue-i18n` | `src/shared/i18n/locales/fr.json` + `en.json`, and the `t()` mechanism | `src/lib/backoffice-i18n.ts`, `src/lib/hotel-i18n.ts`, components |
| `bo-sidebar-workspace` | `src/widgets/bo-sidebar/`, `src/entities/workspace/`, `src/entities/session/` | `src/components/backoffice/`, `src/lib/backoffice-i18n.ts` |
| `bo-pages-panels` | `src/pages/back-office-home/`, CRUD pages, widgets, category/partner entities | `src/pages/backoffice/`, `src/components/backoffice/`, backoffice-i18n |
| `hotel-side` | `src/pages/hotel-home/`, `src/pages/bar-programme/`, hôtel features | `src/components/hotel-home/`, `hotel-demo/`, `steps/`, hotel-i18n |
| `auth-gates-errors` | `src/pages/login/`, forbidden/not-found, gates, navigation | `src/components/auth/`, `src/components/errors/`, pages-erreur.md |

### Reader task (verbatim, one per unit)

    Audit question: every user-visible string in the app (i18n, hardcoded,
    aria-label, placeholder, title, errors, tooltips) must match the proto for
    the SAME screen/element, character-exact, FR and EN.

    App: <APP>. Proto (source of truth): <PROTO>.
    Your partition (read ALL of these files):
    - …

    RULES:
    - App implements a subset of the proto: a proto-only feature is NOT a finding.
    - Character-exact: accents, case, punctuation, ’ vs ', nbsp, … vs ...
    - Cite protoRef as file:line. No proto equivalent → category=extra-text,
      protoText="", protoRef="introuvable".
    - Forbidden: style opinions. Categories: wording-mismatch, missing-text,
      extra-text, translation-mismatch, punctuation-case.
    - Severity: high (user-visible), medium (rare), low (aria/technical
      placeholder/tooltip).

## Phase 3 — Adversarial verification

Before synthesis, verify every reader finding against the actual files (read
them yourself or via a fresh verification pass). Two classes are auto-rejected
(`isReal=false`): **invented error toasts** and **proto-FR-stuck-in-EN that the
app translates properly**.

### EXCLUDE (before any verification)

| Screen / class | Reason |
|---|---|
| `pages/forbidden/`, `pages/not-found/`, `app/ui/GateError` | Error pages not implemented yet |
| `pages/login/` | Disposable screen, replaced at the OIDC cutover |
| Invented error texts (deleteConflict, undoFailed, generic errors) | The proto does not model these toasts |
| FR frozen in the proto's EN that the app translates properly | Not a drift |

## Phase 4 — Synthesis

Report: verdict, confirmed findings grouped by screen, rejected with reason,
excluded, counters (units, failed, filesRead, raw → triaged → confirmed →
rejected). `stats.failed` must appear.

## Correction (if requested)

Follow `~/.pi/agent/skills/accor-conventions/SKILL.md`: branch `fix/<kebab>`
from an up-to-date `develop`, atomic Conventional Commits, green baseline
`pnpm --filter @astore/api build && pnpm typecheck && pnpm lint && pnpm test`,
PR against `develop`.
