# Extensions — writing conventions

Applies to every file created or modified under `extensions/`. Follow the existing structure of this config; do not invent new layouts.

Read `~/.pi/agent/ARCHITECTURE.md` before changing extensions or shared UI; it defines ownership and the authoritative modules.
Read `~/.pi/agent/extensions/DESIGN.md` before restyling or migrating any pi render surface (tool rows, chrome, transcript); it is the migration checklist and status tracker for the TUI restyle.

## Layout — domain folders

- One folder per extension, grouped by domain: `extensions/<domain>/<extension-name>/`, kebab-case, entry point `index.ts`.
- Domains (closed list):
  - `ui/` — display surfaces and chat chrome: `renderers/`, `hud-footer/`, `hud-status/`, `hud-telemetry/`, `ask-user-question/`.
  - `prompt/` — prompt and editor input path: `attachments/`, `double-escape-clear/`, `inline-skills/`, `skill-surface/`.
  - `model/` — provider/model behavior: `fallback/`, `clean-provider-errors/`.
  - `tools/` — tool-call behavior: `guard/`, `lazy-load/`, `lookup/`.
  - `fetch/` — web content fetchers: `social/`, `twitter/`.
  - `herdr/` — herdr bridge extensions: `prompts/`.
  - `commands/` — user-invoked commands and workflows: `simplify/`, `usage/`, `goal/`, `context-budget/`, `dump/` (a `/review` command belongs here too).
- No domain prefix in member names: the parent folder IS the domain. Sole exception: the `hud-*` chat-chrome family keeps its prefix as part of its name. Never rename a domain member to re-add its domain prefix.
- Root level holds only: the shared library `lib/`, the subagents package config `subagent/`, the two herdr-generated flat files (`herdr-agent-state.ts`, `herdr-pane-meta.ts`), and these docs.

## Loading contract (verified against pi 1.0.3 `dist/core/extensions/loader.js`)

- pi discovers extensions at ONE level only: direct `extensions/*.ts` files, `extensions/<dir>/index.ts`, or a `<dir>/package.json` with a `pi` manifest. A nested folder is silently ignored — `extensions/<domain>/<name>/` would never load by discovery alone.
- The domain folders are therefore declared explicitly in `~/.pi/agent/settings.json` under `extensions` (`"extensions/prompt"`, `"extensions/model"`, `"extensions/tools"`, `"extensions/fetch"`, `"extensions/herdr"`, `"extensions/ui"`). pi resolves them from the agent directory and scans each one level deep.
- NEVER create a `package.json` anywhere under `extensions/<domain>/` — not even a `pi` manifest. A nested `package.json` becomes the nearest package scope, and Node forbids `imports` targets that escape it (`ERR_INVALID_PACKAGE_TARGET`), so every `#lib/*` import under it fails to resolve (verified). The same applies to `index.ts` inside a domain folder: never add one.
- `#lib/*` resolves from the ROOT `package.json` (`imports: "#lib/*" → "./extensions/lib/*"`). It only works because no intermediate `package.json` exists between an extension file and the root.
- Root-level flat files need no settings entry: default discovery loads them. Every domain folder (including `commands/`) is in the settings list.

## Adding a new extension — mandatory steps, in order

1. Pick the domain from the closed list above. If none fits, ask the human before inventing one.
2. Create `extensions/<domain>/<name>/index.ts` exporting `export default function <camelCaseName>(pi: ExtensionAPI): void`. No settings edit, no manifest: the domain folder is already wired.
3. Write a header JSDoc block in `index.ts`: what the extension does and the module structure it uses.
4. Imports: `#lib/*` for shared modules, relative with explicit `.ts` inside the extension. Never `../lib/...` relative paths, never a cross-domain relative path when `#lib` or `pi.events` can carry it.
5. Verify (from `~/.pi/agent`): `pnpm run lint`, `pnpm run type-check`, `pnpm exec oxfmt --write <files>`, then `/reload` in the current session, then from a DIFFERENT cwd run `pi -p 'Reply READY'` and confirm zero `Failed to load extension` lines.

## Moving or renaming an extension — mandatory steps, in order

1. `grep -rn "<old-name>"` across `extensions/`, `ARCHITECTURE.md`, `DESIGN.md` — update every relative import and path reference.
2. Root-level flat files keep their name in default discovery; domain members need no settings change (the domain folder is what is listed).
3. Re-run the verify loop from the section above. A rename that breaks `#lib` resolution is a broken session: check the headless run before declaring done.

## Shared library and cross-extension state

- `extensions/lib/` holds every folder WITHOUT `index.ts` (e.g. `lib/ui/`); extensions import from its modules directly. Never add an index.ts there. Only pure functions survive that crossing: jiti gives every extension its own module registry, so a module variable one extension sets reads empty in another (verified: a shared module's state stayed `unset` across two loaded extensions). Cross-extension *state* goes through `globalThis` under a versioned `Symbol.for` key read with `Reflect` (see `ui/renderers/tool-durations.ts`) or through `pi.events`.
- Extensions load in this order: default discovery of the global `extensions/` dir (flat files), then the settings `extensions` list in its declared order, then each domain's members in directory order. Keep that order in mind for editor-decorator chaining (`lib/ui/editor-decorator.ts` builds the base editor exactly once for the first registered decorator).

## Herdr-managed files

- `extensions/herdr-agent-state.ts` and `extensions/herdr-pane-meta.ts` (flat files, `@ts-nocheck`/generated, `HERDR_INTEGRATION_VERSION` header) are generated and overwritten by the herdr integration at the root of `extensions/`: never edit, lint, type-check, format, or MOVE them — herdr recreates them at these paths. Add custom herdr-side extensions under `extensions/herdr/` instead.

## Tests

- The config carries no test tree. An agent writes a test only under an explicit test authorization (`../AGENTS.md` # Tests); when authorized it lives at `../tests/<name>.test.ts` (relative to a module under `extensions/`), `node --test`. Run it with `pnpm run test` — it passes `--experimental-transform-types`, so parameter properties and enums load; a hand-written `node --test` fails on those with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Keep logic importable and testable without a TUI.

## Imports

- Relative imports keep their explicit `.ts` extension (pi runs these files directly via type stripping, nothing is emitted).
- Shared-library imports use the `#lib/*` subpath alias (root `package.json` `imports`: `#lib/*` → `./extensions/lib/*`). jiti, tsc and `node --test` all resolve it; do not write `../lib/...` relative paths in extension files.
- Dependencies: only `@earendil-works/pi-*` packages, `node:*` builtins, and `typebox`. Never add a runtime dependency.
- Value imports first, then a separate `import type` block; both sorted, absolute paths before relative ones.

## Verify (run from `~/.pi/agent`)

```bash
pnpm run lint                    # oxlint
pnpm run type-check              # tsc --noEmit
pnpm exec oxfmt --write <files>  # exactly the files you touched
pnpm run test                    # node --experimental-transform-types --test 'tests/**/*.test.ts' — when covered code changed
```

- After changes: `/reload` in the current session.
- When launching an interactive child Pi inside Herdr for UI checks, remove `HERDR_ENV`, `HERDR_SOCKET_PATH`, and `HERDR_PANE_ID` from its environment; inherited pane identity lets the child overwrite the parent's lifecycle sequence ([Herdr #2668](https://github.com/herdrdev/herdr/issues/2668)).
- Headless load check from another cwd: `pi -p 'Reply READY'` — any `Failed to load extension` line means a broken import or a forbidden nested `package.json`.
- Syntax check a single file: `npx esbuild <file>.ts --outfile=/dev/null --format=esm --packages=external`.
