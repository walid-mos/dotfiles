# Turn-diagnostics playbook — "spinner forever" in the desktop app

Real case (2026-09-01): user reported Hermes "tournait dans le vide à l'infini". Root cause chain: desktop app update restarted the gateway mid-turn (evidence: `state.db.pre-update-emergency-*.bak` files, `desktop-update-handoff.log`, gateway restart at 20:05) → turn interrupted → `auto-continue scheduled for session … (attempt 1, interrupted Ns ago)` re-launched it with a `[System note: Your previous turn was interrupted mid-run…]` message → turn was actually progressing, but on the OpenRouter fallback model (`z-ai/glm-5.3-flash`) at ~10 s per API call with many small tool calls.

## Step 1 — confirm the turn is alive, not deadlocked

```bash
grep <agent_session_id> ~/.hermes/logs/agent.log | tail -20
```

Session id format: `YYYYMMDD_HHMMSS_xxxxx` (visible in the log lines). Healthy-but-slow looks like:

```
[<sid>] agent.conversation_loop: API call #4: model=… in=… out=… latency=12.1s
[<sid>] agent.tool_executor: tool terminal completed (0.13s, 1564 chars)
```

- Lines advancing every few seconds → turn is WORKING, just slow. Say so; don't kill it blindly.
- No new lines for minutes and last line is an API call without completion → genuinely stalled.

## Step 2 — find why it (re)started

```bash
grep "auto-continue scheduled" ~/.hermes/logs/agent.log | tail
ls -lt ~/.hermes/state.db.pre-update-emergency-*.bak
tail ~/.hermes/logs/desktop-update-handoff.log
```

`auto-continue` = the gateway re-runs a turn interrupted by an app restart/update. The re-launched turn starts with a system note about the previous turn being interrupted. This is the mechanism behind most "infinite spinner after update" reports.

## Step 3 — identify the model actually running the turn

Every `API call #N` line names `model=` and `provider=`. If it's the OpenRouter fallback (e.g. `z-ai/glm-5.3-flash`) instead of the primary (`gpt-5.6-luna`), expect: 5–15 s per call, many small tool-call turns, occasional 60–100 s outliers, and a turn budget of `agent.max_turns` (default 500) — a chatty fallback model can legitimately run tens of minutes.

## Remedies

1. `/stop` (or stop button) in the affected conversation — the auto-continue re-run does stop on demand.
2. Resume the conversation on the primary model; the fallback is for availability, not for long tool-heavy turns.
3. If fallback marathons recur: lower `agent.max_turns` in `~/.hermes/config.yaml` (500 is very high for a flash-class fallback).
4. Auxiliary-lane spend note seen in logs: `auxiliary.free_only: true` or `auxiliary.openrouter_model` (a `:free` SKU) restricts the paid-lane fallback.

## Pitfalls

- Don't conclude "stuck" from the spinner alone — the UI shows a spinner for any in-flight turn, however long.
- Don't confuse the desktop conversation session id with the `ui_session=` id in `tui_gateway` lines; grep by the `agent_session_id` (`YYYYMMDD_HHMMSS_xxxxx`).
- Gateway restarts also log to `gateway.error.log` (registry check_fn warnings are normal noise, not the cause).
