# pi-subagents

`pi-subagents` lets Pi delegate work to focused child agents: scouting, research, implementation, review, parallel audits, scripted workflows, and background jobs.

This checkout is a vendored fork of upstream `pi-subagents` v0.75.0, trimmed to the surfaces its owner uses inside Pi. See [FORK.md](FORK.md) for the base, the deltas and the removed subsystems.

## Loading it

Pi loads the package from its local path. List the checkout under `packages` in `~/.pi/agent/settings.json`:

```json
{ "packages": ["/path/to/pi-subagents"] }
```

Install its dependencies with `pnpm install`. Background children use the host's SDK: Node-hosted Pi runs them in a detached Node runner, and a Bun-compiled standalone Pi host loads the same runner through its embedded SDK.

## How it works

Pi is the parent session. A subagent is a focused child Pi session with its own job.

When you ask for a subagent, Pi starts the child, gives it the task, and brings the result back. Foreground children run as sessions inside the parent Pi process and stream in the conversation. Background (`async`) children run as sessions inside a detached runner process that keeps working and notifies the parent on completion.

Loading the extension does not start an automatic reviewer. Fresh parent sessions start with the `subagent` tool active, and Pi uses it only when your request or applicable instructions authorize delegation. Complexity alone does not authorize delegation.

Ask in plain language:

```text
Use reviewer to review this diff.
Ask oracle for a second opinion on my current plan.
Use scout to inspect the auth flow before planning.
Run reviewers for correctness, tests, and cleanup in parallel.
Run this in the background.
```

## Builtin agents

| Agent | Use it when you want... |
|-------|--------------------------|
| `scout` | Fast local codebase recon: relevant files, entry points, data flow, risks. |
| `researcher` | Web/docs research with sources and a concise research brief. Requires [pi-web-access in the child](docs/agents.md#web-research-prerequisites). |
| `worker` | Implementation work. Edits files, validates, escalates unapproved decisions instead of guessing. |
| `reviewer` | Code review and small fixes against the task/plan, tests, edge cases, and simplicity. |
| `oracle` | A second opinion before acting. Challenges assumptions without editing. `advisor` is an alias. |
| `delegate` | A lightweight general delegate that behaves close to the parent session. |

Rule of thumb: `scout` before you understand the code, `researcher` before you trust external facts, `worker` to implement, `reviewer` to check, and `oracle` when the decision itself feels risky. User, project and package-declared agent directories (`pi.subagents.agents`) can add or override agents.

## What the `subagent` tool does

- **Single launches**: `{ agent, task }`, foreground or `async: true`, with fresh or forked context, budgets, outputs and artifacts.
- **Scripted workflows**: `workflow: true` runs the one ```` ```js workflow ```` block in the same reply, a path runs a script file, and a name runs a builtin resource (`review`, `run-ci`, `multi-issue-scout`, `parallel-gates`). Scripts use `runs.run`, `runs.all`, `runs.lanes` and `runs.steer`.
- **Isolation**: `worktree: true` gives writers their own Git worktree; `worktree.discard` drops preserved work.
- **Control**: `status` (including fleet and transcript views), `steer`, `interrupt`, `stop`, `resume`, `children.list`, `grant-spawn-budget`, `lane.status`.
- **Management**: `list`, `models`, `doctor`, `validate`, `guide`, explicit missions.
- **Coordination**: children can ask the parent through `contact_supervisor`, and the parent answers with `subagent_supervisor`. `bg_wait` blocks on background work when same-turn results are needed.

Runs have no default wall-clock deadline. Inactivity raises attention after two minutes and marks a run `stale` after ten, without stopping it; set `timeoutMs` only when a hard cap is wanted.

## Slash commands

| Command | Purpose |
|---------|---------|
| `/run` | Launch a single agent. |
| `/subagents` | Interactive admin: inspect agents and edit model, thinking or system prompt. |
| `/subagents-fleet` | Live fleet inspector: browse children, read transcripts, steer or stop runs. |
| `/subagents-detach [run-id]` | Detach an active foreground single run without terminating its child. |
| `/subagent-cost` | Parent plus child token usage and cost for the session. |
| `/prompt-workflow` | Run a prompt template as a native workflow script. |

In the TUI, FleetView below the editor keeps active work visible.

## Help and diagnostics

Use `subagent({ action: "doctor" })` to check setup, and `subagent({ action: "guide", topic: "workflows" })` for installed-version help. The default topic is `overview` (this file); the other topics are `workflows`, `agents`, `missions`, `observability`, `tool-reference`, `configuration`, `models`, and `extension-api`.

## Documentation

| Doc | What's in it |
|-----|--------------|
| [Agents](docs/agents.md) | Custom agents, frontmatter reference, overriding builtins, tools, extensions, skills, per-agent memory. |
| [Models](docs/models.md) | Model selection, defaults, per-role overrides, thinking levels, model scope enforcement. |
| [Workflows](docs/workflows.md) | Orchestration patterns, scripted workflows, worktree isolation, child-to-parent coordination, the recursion guard. |
| [Tool reference](docs/tool-reference.md) | Every `subagent` parameter, management actions, status/control actions, acceptance gates. |
| [Observability](docs/observability.md) | FleetView, the fleet inspector, lifecycle artifacts, events, logs. |
| [Missions](docs/missions.md) | Explicit mission records and delivery receipts. |
| [Configuration](docs/configuration.md) | Every `config.json` key and environment variable. |
| [Extension API](docs/extension-api.md) | Foreground progress correlation, the agent-roster event, inspector actions, Herdr integration, host session lifetime. |

## License

MIT. Original copyright Nico Bailon; see [LICENSE](LICENSE).
