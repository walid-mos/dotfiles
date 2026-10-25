# Source

The owner's fork of `pi-frontend-check`, vendored into Pi. This directory is the
only copy and is not under version control: edit it in place. The fork keeps the
upstream frontend-testing tools but drives the installed Brave instead of a
downloaded Chromium build, and adds the shared Infisical vault tools
(`extensions/shared-vault.ts`) plus the `shared-web-logins` skill.

|                |                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------ |
| Upstream       | https://github.com/sebaxzero/pi-frontend-check                                             |
| Fork base      | commit `afd74c8` (branch `brave-integration`, single squashed fork commit)                 |
| Vendored on    | 2026-10-04                                                                                 |
| License        | MIT (upstream, per its README)                                                             |
| History bundle | `~/.pi/agent/git/pi-frontend-check-brave-integration.bundle` (machine-local, never synced) |

Local divergences maintained on top of the fork base:

- 2026-10-07 — `frontend_batch` `type` accepts password fields on dev/test origins only (`extensions/browser-origin.ts` classification: localhost / private hosts / `.local` / `.test`), for disposable test accounts; production origins keep the vault-only fill. Touched `extensions/page-actions.ts`, `extensions/tools.ts`, `README.md`, `skills/shared-web-logins/SKILL.md` per the same directive.
- 2026-10-09 — Hermes decoupled: the managed shared browser (`scripts/shared-browser.py`, `docs/shared-browser.md`, launchd `fr.nextnode.agent-browser`) is removed, `extensions/shared-vault.ts` falls back to `os.tmpdir()`, enrollment moves to `shared-web-logins/enroll.py` (terminal, masked prompts). Touched `extensions/shared-vault-tools.ts`, `shared-web-logins/{README.md,broker.py}`, `skills/shared-web-logins/SKILL.md`, `README.md`, `AGENTS.md`, `package.json`.
- 2026-10-11 — Profile footprint: isolated browsers launch with `--disk-cache-size=1 --disable-gpu-shader-disk-cache` from the single launch and context options in `extensions/browser-launch.ts` (the ephemeral session browser now reuses `launchBrowser` + `openContext`), and the load-time sweep moved to `extensions/state-maintenance.ts`, with per-profile rules in `extensions/profile-store.ts` `maintainProfileDir`: it dates a profile by its `Local State` mtime, skips a profile whose `SingletonLock` names a live process (a stale lock from a killed session does not exempt it), removes profiles past 14 days and prunes the regenerable cache directories of the others. `extensions/error-code.ts` holds the one Node error-code check (`profile-store.ts`, `config.ts`). Touched `extensions/browser-connection.ts`, `extensions/index.ts`, `README.md`, `AGENTS.md`.
- 2026-10-11 — Capture retention: `extensions/state-maintenance.ts` removes pixel captures and specimens older than the same 14-day window it applies to profiles, at extension load; wired in `extensions/index.ts`, documented in `README.md`, `AGENTS.md` and `~/.pi/agent/skills/accor-ship/visual-gate.md`.
- 2026-10-11 — Session browser economy: `browser-connection.ts` `connectSessionBrowser` adopts the blank tab a persistent context opens and closes restored extras instead of creating a second page (one renderer less per session), and exposes `withScratchPage`; `pixel-diff.ts` runs `frontend_pixels mode=diff` in that scratch tab, launching a cold Brave only when no session browser is open (`pixel-tools.ts`, `browser.ts`, `README.md`).
- 2026-10-13 — Native PDF launch configuration: `browser-launch.ts` excludes Playwright's `--disable-extensions` default argument through `ignoreDefaultArgs`. The PDF component has no background page, so the background-component restriction stays enabled. Headless mode, isolated profiles, sandboxing and cache rules stay unchanged. `README.md` records the required Pi reload and in-app check. Existing browser checks time out with both the original launch options and this change. PDF rendering and scrolling are not yet verified.
