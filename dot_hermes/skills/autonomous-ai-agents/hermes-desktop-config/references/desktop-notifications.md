# Desktop native notifications — details (verified on v0.20.5 / 2026.8.19)

Shipped in v2026.6.19 (PR #45866): Electron `Notification` API, routed cross-OS, distinct from the in-app toast feed.

## Storage (device-local, renderer localStorage)

| Key | Content |
|---|---|
| `hermes:native-notifications` | `{enabled: bool, kinds: {approval, input, turnDone, turnError, backgroundDone, credits, plugin: bool}}` — all default true |
| `hermes.desktop.completionSoundVariantId` | completion sound variant 1–14 (default 1) |

Not in config.yaml — cannot be set via `hermes config set`. The "Send test notification" button fires regardless of focus and surfaces an in-app toast confirming whether the OS accepted it.

## Firing rules (store/native-notifications.ts)

- "Backgrounded" = `document.hidden` OR `!document.hasFocus()` — alt-tab counts.
- Completion kinds (`turnDone`, `turnError`, `backgroundDone`): fire only when backgrounded AND only for the active session (busy gateways can't spam per background session).
- Attention kinds (`approval`, `input`): also break through for an off-screen session while the window is focused — a blocking prompt in a background session still surfaces.
- 1s throttle per (kind, session). 4s quiet window after any gateway connect/reconnect/profile switch (`store/notify-baseline.ts`) so replayed state doesn't notify.
- `backgroundDone` detected in `store/composer-status.ts` at the `running → exited` transition of background processes.
- Click focuses the window and jumps to the session; approval toasts carry Approve/Reject buttons (buttons render on signed macOS builds only).

## macOS specifics

- Notifications respect Réglages Système → Notifications per-app settings; a silent failure there isn't a Hermes bug.
- TCC/notification grants are keyed to the app's code-signing identity. Locally built/self-updated apps use a stable ad-hoc identity so grants persist. Reset stuck permissions: `tccutil reset All com.nousresearch.hermes`.
- No per-app notification volume control yet — open feature request (GitHub issue #87473); sound choice is changeable, volume follows system.

## Related but different surfaces (don't mix)

- `display.bell_on_complete` (config.yaml): terminal/TUI bell, not desktop notifications.
- Gateway "Background Process Notifications" (`display.background_process_notifications`): messages pushed to messaging-platform chats.
- Plugin SDK `ctx.os.notify({...})`: same native pipeline, gated by Settings → Notifications → "Plugin notifications".

## Source entry points (install dir `~/.hermes/hermes-agent/`)

- `apps/desktop/src/store/native-notifications.ts` — prefs + gating engine
- `apps/desktop/src/store/notify-baseline.ts` — post-connect quiet window
- `apps/desktop/src/store/completion-sound.ts` — sound variant store
- `apps/desktop/src/app/settings/notifications-settings.tsx` — settings UI
- `apps/desktop/src/hooks/use-message-stream.ts` — dispatch sites for message events
