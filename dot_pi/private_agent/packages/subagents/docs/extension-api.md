# Extension and integration APIs

Process-local seams for sibling Pi extensions and host integrations: foreground progress correlation, the agent-roster event, the inspector actions, the Herdr integration, and host session lifetime. The package exposes no import subpaths; Pi loads it through `pi.extensions`.

## Foreground progress correlation

Foreground progress updates carry `runId` as soon as foreground execution allocates it, so a caller can retain the package-owned revival target even if its own tool turn is interrupted before the terminal response. Foreground `details.results[]` rows also include a numeric `index` that is unique within the run and stable across partial progress snapshots and the final result; use `(runId, index)` instead of row position to correlate single, counted parallel, and chain children.

## Agent roster for sibling surfaces

A surface that lets a user configure a per-agent model needs the agents that exist, not just the ones already configured. The installed `pi-subagents` owner answers a read-only roster on the process-local `pi-subagents:agent-roster:v1` event. Event delivery is synchronous, so the owner writes the result onto the request before `emit()` returns: emit, then read `request.result`.

```typescript
const request: {
  version: 1;
  cwd: string;
  preferredModelProvider?: string;
  result?:
    | {
        version: 1;
        cwd: string;
        agents: Array<{
          name: string;
          description: string;
          aliases: string[];
          source: "builtin" | "package" | "user" | "project";
          filePath: string;
          model?: string;
          modelOrigin?: "override" | "agent" | "default";
          modelScope?: "user" | "project";
          modelPath?: string;
          inheritsModel: boolean;
          thinking?: string;
          thinkingOrigin?: "override" | "agent";
          thinkingScope?: "user" | "project";
          thinkingPath?: string;
          inheritsThinking: boolean;
        }>;
        maxThinking?: string;
        settingsPaths: { user: string; project: string | null };
      }
    | { error: string };
} = { version: 1, cwd: process.cwd() };

pi.events.emit("pi-subagents:agent-roster:v1", request);
// request.result is undefined when no compatible owner handled the event.
```

The roster is the launch path's own discovery projection with every settings layer already merged, so `model` and `thinking` are what a child would run before session inheritance, and `modelOrigin`/`thinkingOrigin` say which layer supplied them: `override` (a settings pin, with its `scope` and `path`), `agent` (the definition's own frontmatter), or `default` (`subagents.defaultModel`). `inheritsModel`/`inheritsThinking` mark an agent that configures nothing of its own. Disabled agents are omitted: a pin on one would be a stored value nothing reads. `preferredModelProvider` selects the provider-specific settings overrides the way a launch from a session on that provider would, and the roster reads the same discovery cache and global package root as launches. A request with a different `version`, a missing `cwd`, or a discovery failure answers `{ error }`; callers must treat an absent result like a missing package rather than an empty roster.

This contract is process-local and read-only: it neither changes discovery nor registers anything.

## Inspect integration

Inspect is the portable command and action surface for an existing async run. The public actions are:

```ts
subagent({ action: "inspector.command", id: "<run-id>", index: 0 })
subagent({ action: "inspector.open", id: "<run-id>", index: 0, focus: true })
subagent({ action: "inspector.status", id: "<run-id>", index: 0 })
subagent({ action: "inspector.close", id: "<run-id>", index: 0 })
```

`inspector.command` returns a standalone runner command without contacting a host or writing a binding. `inspector.open` selects an available built-in inspector plugin. `status` and `close` select the plugin that owns the run binding and report clearly when that plugin does not support the requested lifecycle action. Without an available plugin, `open` fails closed with an actionable message; ordinary launches remain headless. Closing an inspector never stops the run.

### Herdr inspector plugin

The bundled Herdr inspector plugin supports Herdr 0.7.5+. It opens a raw dashboard pane, not the child session and not a literal attach. It reads lifecycle, status, output, and mission artifacts; steer and stop continue through pi-subagents' existing control inbox. Use `focus` only with `inspector.open`; Herdr 0.7.5 cannot focus an arbitrary existing raw pane id.

## Herdr integration

When Pi runs inside [Herdr](https://herdr.dev), pi-subagents automatically reports active async-run counts through Herdr pane metadata.

- The bridge is enabled only when Herdr supplies `HERDR_ENV=1` and `HERDR_PANE_ID`; outside Herdr it registers no listeners or timers.
- It restores current-session active runs after `/reload` or `/resume`, refreshes metadata while work is active, and clears it on completion or shutdown.
- The bridge uses Herdr's existing `herdr:blocked` sibling event when an async child needs attention, and emits `herdr:busy` while async work remains. Herdr versions that support the sibling event keep the pane's semantic state `working`; older versions ignore it safely and still display the metadata label while the Pi integration remains the lifecycle authority.
- The owning Pi session is the only publisher for its own pane metadata. When an active workflow has an explicit bounded `label`, the newest active label appears in the summary and compact `title-suffix`; overlapping completion restores the previous active label. Raw task and goal prompts never enter Herdr metadata. Without a label, one active run uses its agent name and two or more use the active-run count. Attention adds `⚠`, and the suffix is cleared when active work reaches zero.

To show the reported label in the expanded Agent sidebar, include `state_text` or `$summary` in its row layout:

```toml
[ui.sidebar.agents]
rows = [
  ["state_icon", "workspace", "tab"],
  ["agent", "state_text"],
]
```

## Host session lifetime and completion wakes

A host that embeds this extension owns whether completion wakes can be delivered at all.

Ordinary async and foreground completion wakes use `registerSubagentNotify` and `sendCompletion`. They listen for completion events and deliver through `pi.sendMessage(..., { triggerTurn })`. Session shutdown stops the result watcher and disposes this completion notifier. `createWaitSubscriptionManager` is separate: it is the explicit non-blocking `bg_wait` subscription path for work without native notification, not the ordinary completion wake path.

Detached children do not stop when the session does. They are the host process's children, not the session's, so the run keeps going, completes, and notifies nobody. What is lost is the notification, not the work.

This matters because "is the parent busy?" is the wrong idle signal. A parent that launches a detached run and hands control back — which is what the async launch output tells it to do — is not prompting, streaming, compacting, or running a shell command. A host that reaps sessions on those signals alone will dispose exactly the session that was waiting to be woken.

If your host reclaims idle sessions, keep a session alive while it still has live detached work:

- Read run state from the status files under the async run directory rather than from event traffic. A long, quiet workflow sends almost nothing to the parent, so recent-activity heuristics conclude the wrong thing.
- Treat `queued` and `running` as live, matching `isActiveAsyncState`. An interrupted run that is `paused` is finalized. A workflow that paused because a child used `contact_supervisor` still has a live child; keep that parent session until reconcile writes `complete` or `failed`.
- Do not treat `lastUpdate` as a heartbeat. The runner advances it in memory every second but only rewrites `status.json` when the activity classification changes, so a live run inside one long quiet tool call leaves a stale file behind. Judging liveness by file age will reap exactly the run you meant to protect.
- Prefer the recorded `runnerPid`, which stays true through a silent tool call and goes false when the runner dies. Async workflow roots record `ownerPid` (the owning Pi process) instead; a dead owner means the workflow is orphaned and reconciliation marks it failed. Keep file age only as a fallback for runs that record neither, and give it a wide window.
- Match `sessionId` in `status.json` against both forms. It is resolved as `getSessionFile() ?? getSessionId()`, so it is normally the parent's session *file path*, but a session that is not persisted records a bare session id instead.

The symptom when this is missed is quiet and easy to misattribute: subagents appear never to report back, which looks like a fault in this extension rather than in the host that disposed the listener.

## Runtime files

The main runtime files in this repository:

| File | Purpose |
|------|---------|
| `src/extension/index.ts` | Extension registration, tool registration, message/render wiring. |
| `src/agents/agents.ts` | Agent discovery, frontmatter parsing. |
| `src/runs/foreground/subagent-executor.ts` | Main execution routing for single, parallel, chain, management, status, interrupt, and doctor actions. |
| `src/runs/foreground/execution.ts` | Core foreground `runSync` handling: drives one in-process child session per attempt. |
| `src/runs/shared/child-session.ts` | In-process child session factory (`createAgentSession` behind an injectable seam) and the shared model runtime; used by both launch paths. |
| `src/runs/shared/child-launch.ts` | Builds the tool plan, typed child runtime config, and session launch for a child in either host process. |
| `src/runs/shared/child-tool-plan.ts` | Tool, MCP, and extension resolution for a child launch. |
| `src/runs/shared/child-runtime-config.ts` | `ChildRuntimeConfig`: everything the child-side hooks need. |
| `src/runs/shared/child-hooks.ts` | The inline hook extensions every child gets (prompt runtime, fast mode, fanout). |
| `src/runs/background/subagent-runner.ts` | Detached async runner; hosts background child sessions in its own process. |
| `src/runs/background/run-child-session.ts` | Drives one background child session and mirrors its events into the run artifacts. |
| `src/runs/background/runner-aliases.ts` | Aliases the host peer packages to the installed pi package for the runner (`JITI_ALIAS`). |
| `src/runs/background/async-execution.ts` | Background launch support. |
| `src/runs/background/async-status.ts` | Status discovery and formatting for async runs. |
| `src/workflows/scripted-workflow.ts` / `src/runs/foreground/subagent-executor.ts` | Scripted workflow orchestration and child launch routing. |
| `src/shared/settings.ts` | Chain behavior, instructions, and config helpers. |
| `src/runs/shared/worktree.ts` | Git worktree isolation. |
| `src/intercom/intercom-bridge.ts` | Runtime intercom bridge instructions and diagnostics. |
| `src/extension/schemas.ts` / `src/shared/types.ts` | Tool schemas, shared types, and event constants. |
| `test/unit/` / `test/integration/` | Unit and loader-based integration tests. |
