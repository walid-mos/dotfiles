# Extensions — writing conventions

Applies to every file created or modified under `extensions/`. Follow the existing structure of this config; do not invent new layouts.

Read `~/.pi/agent/ARCHITECTURE.md` before changing extensions or shared UI; it defines ownership and the authoritative modules.

## Layout

- One folder per extension: `extensions/<name>/` (kebab-case), entry point `index.ts` — pi auto-discovers `extensions/<dir>/index.ts`.
- Flat files, kebab-case, one concern per file. Split pure domain/state/renderer logic into their own modules; keep TUI wiring (`*-component.ts`, `index.ts`) thin.
- A folder WITHOUT `index.ts` is a shared library, not an extension (e.g. `ui/`): other extensions import from its modules directly. Never add an index.ts there.
- Tests live in `../tests/<name>.test.ts` (relative to a module under `extensions/`), `node --test`. Keep logic importable and testable without a TUI.

## Entry point

- `index.ts` starts with a header JSDoc block: what the extension does and the module structure it uses.
- Export `export default function <camelCaseName>(pi: ExtensionAPI): void` (default-export rule is disabled for `extensions/**` on purpose).

## Imports

- Relative imports keep their explicit `.ts` extension (pi runs these files directly via type stripping, nothing is emitted).
- Dependencies: only `@earendil-works/pi-*` packages, `node:*` builtins, and `typebox`. Never add a runtime dependency.
- Value imports first, then a separate `import type` block; both sorted, absolute paths before relative ones.

## Verify (run from `~/.pi/agent`)

```bash
pnpm run lint                    # oxlint
pnpm run type-check              # tsc --noEmit
pnpm exec oxfmt --write <files>  # exactly the files you touched
pnpm run test                    # node --test 'tests/**/*.test.ts' — when covered code changed
```

- After changes: `/reload` in the current session.
- Syntax check a single file: `npx esbuild <file>.ts --outfile=/dev/null --format=esm --packages=external`.
