---
name: hermes-desktop-config
description: "Use when configuring or verifying Hermes — desktop settings, `hermes doctor` health checks, plugins, notifications."
version: 1.0.0
---

# Hermes Desktop — configuration & verification

Class-level know-how for answering "can Hermes do X in the desktop app / where is that setting" and for *verifying* real config state. The bundled `hermes-agent` skill is the hub; this file holds the details that session work actually surfaced.

## Golden rule: verify real state, never trust the UI pane

The desktop **Settings → Plugins** pane lists every bundled plugin with toggles that can render ON even when nothing is loaded. The authoritative state is:

```bash
hermes plugins list          # status column: enabled / disabled / not enabled
grep -A10 "^plugins:" ~/.hermes/config.yaml
```

`plugins.enabled: []` in config.yaml means **zero plugins active**, regardless of what the UI shows. Before telling the user "you use plugin X", check:

1. `hermes plugins list` status
2. config.yaml `plugins.enabled`
3. whether the required API key exists in `~/.hermes/.env` (a plugin without its key is inert even if enabled)

## Two things named "browser use" — do not confuse them

| | Built-in `browser_exec` | Plugin `browser-browser-use` |
|---|---|---|
| What | Browser Use **CLI mode** of the built-in browser tool | Cloud backend at api.browser-use.com |
| Backend | Any CDP target (e.g. `browser.cdp_url: http://127.0.0.1:9223` = local Chrome) | Remote cloud browser |
| Auth | None (CDP) | `BROWSER_USE_API_KEY` or Nous gateway |
| Independent? | Yes — hardcoded in `tools/browser_tool.py`, not gated by the plugin | Separate plugin in `plugins/browser/browser_use/` |

If a user's workflow uses `browser_exec` with a local `cdp_url`, disabling the browser-use **plugin** breaks nothing. Check `.env` for `BROWSER_USE_API_KEY` before claiming the cloud backend is in play.

## Desktop native notifications (shipped v2026.6.19)

- **Where configured**: Settings → Notifications (bell icon) in the desktop app. **Device-local** — renderer localStorage, NOT config.yaml. Keys: `hermes:native-notifications` (master `enabled` + per-kind map), `hermes.desktop.completionSoundVariantId` (completion sound, variants 1–14).
- **Kinds**: `approval`, `input`, `turnDone`, `turnError`, `backgroundDone`, `credits`, `plugin`.
- **Firing rules**: completion kinds (`turnDone`/`turnError`/`backgroundDone`) fire only when the window is backgrounded or unfocused (alt-tab counts) and only for the active session. Attention kinds (`approval`, `input`) also fire for off-screen background sessions. 1s per-(kind, session) throttle; 4s quiet window after gateway connect (replayed state doesn't notify).
- **Sound**: the turn-end completion sound picker lives in Settings → Notifications (moved from Appearance). No per-app volume control yet (open feature request).
- **macOS side**: if test notifications don't appear, check Réglages Système → Notifications for Hermes; TCC grants are keyed to the app's code-signing identity.
- Related CLI-side config (different surface!): `display.bell_on_complete` in config.yaml governs the terminal bell, not desktop notifications.

## Layout & panes — user "panes are stuck / can't move them"

Verified 2026-09-02 from the desktop docs + desktop-plugin-sdk (do NOT invent layout-preset mechanics from agent tool schemas — answer from these verified facts):

- **When plain drag "doesn't work at all", the answer is LAYOUT EDIT MODE**: **⌘⇧\** (`layout.editMode`, rebindable in Settings → Keyboard Shortcuts; also reachable via ⌘K palette → "Layout editor") enters the FancyZones-style edit mode: a floating draggable **"Layouts" card** appears, zones highlight, and panes can be grabbed and exchanged; **Escape** exits. This is the reliable path — verified 2026-09-02 when a user's direct header-drag did nothing and ⌘⇧\ was the fix offered.
- **Stuck/broken drag** can also mean corrupted persisted layout state (often after an update): **⌘K → "Reset layout"**. Reset also restores plugin panes that were dismissed (closing a plugin's only pane disables the plugin — re-enable in Settings → Plugins).
- **Moving a pane**: drag its **title/header tab strip** (e.g. "Fichiers", "Rappels"), not the content. While dragging, **drop chips** appear on target zones — left/right/top/bottom of a target pane, or **center** to stack as tabs (VS Code model). Drag machinery (from `pane-shell/tree/renderer/drag-session.ts`): pointer-capture drag with a 4 px threshold, the LAYOUT STAYS FIXED while dragging (zones light up, nothing moves until release), Esc aborts, dropping over a tab strip stacks at the divider. ⌘/Ctrl+\ flips sidebars left↔right; ⌘B/⌘J toggle left/right sidebar.
- **Where panes come from**: every pane (native or plugin) registers the same way into the SDK registry — `area: 'panes'`, `data: { placement: 'left'|'right'|'top'|'bottom'|'main', dock?: {pane, pos}, width?, height? }`. `dock.pane` ids include `workspace`, `sessions`, `terminal`, `files`, `review`, `logs`. User's Rappels pane is the `brain-reminders` plugin (placement: 'right', 280px) — same movable status as native panes; never tell the user a plugin pane "can't be moved".
- Layout settings persist per profile and are bundled in profile export/import (window layout ships with exported profiles).
- **Source of truth for desktop UI behavior is on disk**: `~/.hermes/hermes-agent/apps/desktop/src/` (local checkout). Fast greps that answered real questions: layout edit mode = `components/pane-shell/edit-mode.tsx` (`$layoutEditMode`), drag engine = `pane-shell/tree/renderer/drag-session.ts`, pane registration/drag wiring = `pane-shell/tree/renderer/tree-group.tsx`, presets = `pane-shell/tree/presets.ts`. Grep the source BEFORE guessing UI mechanics; docs (llms-full.txt, desktop-plugin-sdk page) cover pane registration but not every interaction.

Session lesson (2026-09-02): the agent's first answer offered tool-schema-based "layout presets" / focus_pane mechanics that don't describe the real desktop UI — user was angry. For "how do I do X in the desktop app", verify against the desktop docs page or llms-full.txt BEFORE answering; the desktop app has no user-facing layout presets, only drag + ⌘\ + Reset layout.

## "Hermes spins forever" — diagnose before touching anything

An apparently hung turn in the desktop app is usually one of: (a) a **desktop auto-update** that restarted the gateway mid-turn, after which **auto-continue silently re-launches** the interrupted turn (user sees a spinner that is actually a fresh re-run), or (b) a slow fallback model grinding through many small tool calls within a huge turn budget. Full playbook: `references/turn-diagnostics.md`.

Quick triage (all in `~/.hermes/logs/agent.log`):

1. Is it alive? `grep <session_id> agent.log | tail` — look for `agent.conversation_loop: API call #N … latency=` lines advancing every few seconds. Advancing = not stuck, just slow.
2. Why did it restart? Grep `auto-continue scheduled` (re-launch after interruption) and check `ls -lt ~/.hermes/state.db.pre-update-emergency-*.bak` + `desktop-update-handoff.log` for a mid-turn update/restart.
3. Why so slow? The `model=` field in the API-call lines shows if the turn runs on the OpenRouter fallback instead of the primary model; fallback flash models emit many short tool-call turns (5–15 s each) and `agent.max_turns` defaults to 500, so a chatty model can run for a very long time.

Remedies: `/stop` the turn in that conversation; resume on the primary model; lower `agent.max_turns` in config.yaml if fallback-model marathons recur.

## Editing a desktop plugin — the deploy-copy pitfall

Verified 2026-09-02 (brain-reminders widget rewrite): a plugin's desktop UI code lives in
the **source** dir `~/.hermes/plugins/<name>/desktop/plugin.js`, but the app actually loads
the **deployed copy** `~/.hermes/desktop-plugins/<name>/plugin.js`. Editing the source
alone changes NOTHING on screen — the user sees the old widget and reports "rien n'a
changé".

Working sequence:

1. Edit the source (`~/.hermes/plugins/<name>/desktop/plugin.js`).
2. Deploy: `cp ~/.hermes/plugins/<name>/desktop/plugin.js ~/.hermes/desktop-plugins/<name>/plugin.js`
3. Syntax-check the deployed copy: `node --check` (plugin.js is plain ESM — `jsx`/`jsxs`
   from 'react/jsx-runtime', default export with `register(pluginCtx)` + `ctx.registerMany`).
4. User does ⌘K → **Reload desktop plugins** — the in-memory bundle survives deployment
   until then (or app restart).

Useful greps when debugging: `grep -rl "openExternal" ~/.hermes/desktop-plugins/` to find
how the app itself opens external URLs (pattern: `window.hermesDesktop?.openExternal ??
window.open`), and grep `~/.hermes/hermes-agent/apps/desktop/dist/assets/` for the real
bridge API names.

### Opening external/custom-scheme URLs from a plugin (e.g. Obsidian deep-links)

- In the Electron renderer, `window.open('obsidian://…')` is **blocked** (custom scheme).
  The working trigger is `window.hermesDesktop.openExternal(url)` — the native bridge the
  app itself uses — with fallbacks `host.openExternal` then `window.open`.
- Obsidian URL format (validated end-to-end 2026-09-02: `open "obsidian://…"` → Obsidian
  focused on the right note): `obsidian://open?vault=<vault>&file=<path>.md%23<Heading>`.
- **Encoding pitfall**: encode each PATH SEGMENT, never the whole path —
  `path.split('/').map(encodeURIComponent).join('/')`. Whole-path encoding turns `/` into
  `%2F` and Obsidian can't resolve the note. The heading anchor is a literal `%23` +
  `encodeURIComponent(heading)`; spaces become `%20`.
- Sanity-check a deep-link from the shell first (`open "<url>"` then ask System Events for
  Obsidian's front window title) before blaming the plugin code.

## `hermes doctor` on this Mac — known warnings that are NOT problems

Verified 2026-09-01 (Node v24.19.0 via fnm, Hermes 0.21.0):

- **"Node.js not found"** → `~/.local/bin/node` (and npm/npx) are symlinks into `~/.hermes/node/bin/`, a dir Hermes owns and recreates per version. If that dir vanished (e.g. after an update), the links are broken and doctor fails even though fnm has Node. Fix: `ln -sfn ~/.local/share/fnm/aliases/default ~/.hermes/node` — points Hermes's node dir at the fnm `default` alias so it tracks fnm versions. Verify: `hermes doctor | grep Node` shows ✓.
- **`browser` / `browser-cdp` "system dependency not met"** while the doctor still shows `✓ browser-use` and `✓ Node.js` → **intentional masking, not breakage**. In browser-use CLI mode (`_is_browser_use_cli_mode()`, the mode this machine uses), `check_browser_requirements()` returns False by design because `browser_exec` replaces the whole `browser_*` surface. Do NOT install Playwright Chromium or chase dependencies to "fix" this — it is not fixable and not broken. (Installing Chromium first is harmless but unnecessary.)
- Diagnostic path if ever needed: run the availability check directly — `cd ~/.hermes/hermes-agent && ./venv/bin/python -c "import sys; sys.path.insert(0,'.'); from model_tools import check_tool_availability; print(check_tool_availability())"` — then call the per-tool `check_fn` from `tools/browser_tool.py` (`_is_browser_use_cli_mode()`, `_get_cdp_override_raw()`, `_chromium_installed()`) to see which gate fired.

## Bare-minimum / blank-slate harness (verified 2026-09-04)

For "Hermes is too heavy, I want fewer tools/skills by default" — no reinstall needed. Levers, in order of payoff:

1. **Skills: `hermes skills opt-out --remove`** writes a `.no-bundled-skills` marker into the profile dir (`~/.hermes/.no-bundled-skills`). Effect: installer, `hermes update`, and all skill syncs stop re-seeding bundled skills for that profile — permanently. `--remove` deletes ONLY bundled skills byte-identical to the shipped version; hub-installed, local/user-authored, edited, and builtin skills are always kept. Reversible: `hermes skills opt-in --sync` (removes marker + re-seeds). Without `--remove`, nothing on disk is touched. After opt-out, `hermes skills list` shows the remainder — classify by the `Source` column (local = user's own, official = bundled survivors usually disabled, builtin) rather than assuming leftovers = failed deletion.
2. **Toolsets: `hermes tools`** (curses UI) or `hermes tools list` — per-platform toggles persisted to config.yaml. Audit pitfall: **CLI toolset state ≠ desktop session toolset**. A desktop-app session runs the desktop platform toolset (adds `desktop_ui`, `project`, etc.), so `hermes tools list` from a terminal under-reports what a desktop chat actually carries. A long `skills.disabled:` list in config.yaml (~85 entries) is the legacy manual way and becomes obsolete once the marker exists.

   **CRITICAL pitfall (verified in source 2026-09-04, `tui_gateway/server.py:_load_enabled_toolsets` + `hermes_cli/tools_config.py:_get_platform_tools`): an EMPTY toolset list is silently ignored.** `platform_toolsets: {cli: []}` → resolver loads it, gets `enabled = set()`, hits `if not enabled: return None` → falls back to the FULL default hermes-cli toolset. The user thinks they are bare; every desktop session still carries ~50 tools. A profile with an explicit NON-EMPTY list (e.g. `platform_toolsets: {cli: [clarify, file, memory, session_search]}`) is honored. To actually bare-down the default profile, write an explicit non-empty list (via `hermes tools` or `hermes config set platform_toolsets.cli '[...]'`), then verify in a NEW session (tool changes never apply mid-conversation — prompt caching). Working example on this machine: the `comptable` profile is genuinely bare via this exact key.
3. **Memory layers: `hermes config set memory.memory_enabled false`** and `memory.user_profile_enabled false` empties the MEMORY/USER snapshots from the system prompt (volatile tier).
4. **What cannot be removed**: the hardcoded identity/tool-guidance floor of the system prompt. Skills cost less than assumed anyway — progressive disclosure puts only names+descriptions in the prompt.
5. **Alternative without touching the main setup**: `hermes profile create <name> --no-skills` — isolated profile, zero bundled skills, becomes its own command.

Command-set gotcha: `hermes config list` does not exist — use `hermes config show` / `config get` / `config set` / `config check`. `hermes tools list` works (read-only).

## Installation audit checklist (run for "audit notre install hermes / clean it up")

Verified 2026-09-04 on this machine. Read-only pass, ~6 checks, then present a risk-classified plan and wait for go-ahead before deleting anything:

1. **Disk hogs**: `du -sh ~/.hermes/* | sort -rh | head -25`. Safe deletions: `state.db.pre-update-emergency-*.bak` (one per update, ~130–145 MB EACH — three can pile up ≈400 MB) and `state-snapshots/<date>-pre-update` (~130 MB). Both are pre-update safety copies, removable once the update is confirmed healthy. `hermes-agent/` (source + venv, GBs) is the install itself — never touch.
2. **Debug debris**: `~/.hermes/tmp/` (screenshots, probe scripts) and `~/.hermes/sessions/request_dump_*.json` — disposable.
3. **Per-profile opt-out**: the `.no-bundled-skills` marker is PER PROFILE. Opting out `default` does NOT cover named profiles — `hermes -p <name> skills opt-out --remove` for each (check: `ls ~/.hermes/profiles/<name>/.no-bundled-skills`). Otherwise the next `hermes update` re-seeds bundled skills into that profile.
4. **state.db size**: `ls -lh ~/.hermes/state.db` + `sqlite3 ~/.hermes/state.db "SELECT COUNT(*) FROM messages"` — 100+ MB is normal accumulation of messages + FTS index (messages_fts_* ≈ messages in size); purge old sessions only if the user doesn't value chat history, then VACUUM.
5. **Cron health**: `hermes cron list` — look for `error:` last runs (429 usage-limit deaths) and per-run token burn in `~/.hermes/cron/usage_audit.jsonl` (a healthy job is <<1M prompt tokens; 2–3M per run = context bloat to investigate). No `fallback_model:` in config.yaml + a usage-capped primary model = cron jobs silently fail whenever the cap is hit; suggest configuring `fallback_model:` (e.g. openrouter).
6. **Health baseline**: `hermes doctor` + `hermes config check` + `hermes profile list` — treat only non-green items as findings; optional-provider warnings (MiniMax/xAI OAuth, telegram/discord.py) are NOT problems on machines that don't use them.

## Debugging entry points

- Native notif prefs engine: `apps/desktop/src/store/native-notifications.ts`
- Sound store: `apps/desktop/src/store/completion-sound.ts`
- Settings UI: `apps/desktop/src/app/settings/notifications-settings.tsx`
- Dispatch sites: `apps/desktop/src/hooks/use-message-stream.ts`

## Pitfalls

- Don't answer "the plugin list shows it enabled therefore it's active" — see golden rule.
- Desktop notification prefs are per-device localStorage; changing them via CLI/config.yaml is impossible, and wiping app data resets them.
- `hermes plugins list` truncates table cells; grep the name column, not descriptions.