# Source

Vendored copy of the owner's fork of `pi-subagents`. Do not edit it in place
without porting the change back to the history repository (see FORK.md).

| | |
| --- | --- |
| Upstream | https://github.com/nicobailon/pi-subagents |
| Upstream revision | `v0.75.0`, commit `ad56bf92` (2026-10-02) |
| Fork history | `~/Development/tools/pi-subagents`, branch `wm/vendor/main` (local only) |
| Vendored commit | `c595c59bc0afbf961f15747dc74ba239c924ede3` |
| Vendored on | 2026-10-03 |
| License | MIT, © 2026 Nico Bailon (`LICENSE`) |

Refresh: remove every entry here except `node_modules`, then
`git -C ~/Development/tools/pi-subagents archive <commit> | tar -x -C ~/.pi/agent/packages/subagents`,
restore this file with the new commit, and run `pnpm install`,
`pnpm run typecheck`, `pnpm run test` and `pnpm run test:integration` here.
