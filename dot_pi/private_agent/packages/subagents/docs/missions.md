# Missions

Durable records for delegated work: missions wrap runs so you can recover them later.

## Missions

Missions are durable wrappers around runs. The noun map:

- **Project/codebase** — where work happens.
- **Mission** — why delegated work exists and how to recover it later.
- **Run** — one actual subagent execution.
- **Receipt** — proof or a link for an external outcome, such as a PR, CI check, deployment, or release.

Missions are explicit: a launch creates or joins a mission only when it passes `missionId` or a `mission` object, or when you run `mission.create`. Records are JSON files under `~/.pi/agent/missions/projects/<project-hash>/` linking objectives, run ids, lifecycle status, artifact paths, and delivery receipts. Workflow children do not create separate missions. Each workflow child attempt is stored in the enclosing mission with its stable workflow key, run id when known, agent, task metadata, timestamps, session and artifact paths, and latest status heartbeat.

Records created under the old default `<project>/.pi/subagents/missions` stay on disk. Continue them by setting `missions.directory` to that path for the project or by copying the record into the new agent-dir project store. There is no automatic migration.

Behavior:

- `missionId` and `mission` requests are strict before launch. A mission bookkeeping failure after launch marks the result as an error and is reported as `details.missionWarning`.
- Human receipts end with `Mission: <id> (<status>)`, while JSON/structured output text stays unchanged and `details.missionId` is authoritative.
- `mission: false` is still accepted and creates no mission; it is the same as omitting both mission fields.

An explicit `mission` object must have exactly one non-empty `title` or `summary`. `objective` and `labels` are optional.

```ts
const created = subagent({
  action: "mission.create",
  mission: { title: "Ship auth refresh", objective: "Implement and validate token refresh" }
})
// After a ```js workflow block that runs the approved auth refresh plan:
subagent({ workflow: true, missionId: "<mission-id>" })

// Or create and attach in one launch
subagent({ workflow: true, mission: { title: "Ship auth refresh" } })
```

### Managing missions

Use `mission.list`, `mission.show`, `mission.update`, `mission.attach-run`, and `mission.close`.

- Use `mission.update` to record artifacts, labels, summaries, status, and delivery receipts while work runs.
- `mission.show` includes each workflow child's latest status, phase, update time, session path metadata, and heartbeat. The ledger is a recovery record only. It does not schedule or restart children.
- Receipts are durable links for pull requests, CI, deployments, or releases, each with `kind`, `status`, `title`, `url`, and optional `description`. They record delivery state only; pi-subagents does not merge, poll CI, or deploy.
- Use `mission.close` with a terminal status and summary when a mission is done.
- After compaction or restart, resume from `mission.list`/`mission.show` first: `mission.show` refreshes linked async status where available, then use the linked run ids with normal `status`, `steer`, `resume`, or `stop` actions.
- `mission.list` with `missionScope: "global"` reads the user-local pointer index under the Pi agent directory. Project records remain the source of truth, and missing records are reported as stale rather than hiding other projects.

### Cross-project work

Keep same-project tasks on ordinary subagents. Use an explicit `cwd` for small bounded work in another project.

Mission storage configuration (`missions.directory`, `retainTerminal`, `globalIndex`) is in [configuration.md](configuration.md#missions).
