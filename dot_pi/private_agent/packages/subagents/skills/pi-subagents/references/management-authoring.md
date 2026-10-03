# Pi Subagents: Management Authoring

This file is a detailed reference loaded from `skills/pi-subagents/SKILL.md`.

## Management Mode

The `subagent(...)` tool also supports management actions.

### List available agents and legacy chain records

```typescript
subagent({ action: "list" })
```

### List retained children

```typescript
subagent({ action: "children.list" })
```

Lists up to the last 10 retained workflow children from this parent session with explicit `resumable` or `not resumable` rows. This workflow-only roster is not an exhaustive list of direct native children. Resume only rows reported `resumable`. When the exact run id of an intended direct child is known, inspect it with `subagent({ action: "status", id: "<run-id>" })`; if status identifies the candidate, attempt `subagent({ action: "resume", id: "<run-id>", message: "..." })`. Resume performs the authoritative eligibility check and may reject the attempt. Continue one inside a workflow with `runs.run(key, { resume: "<run-id>", task: "follow-up" })`; each workflow key identifies one result lane, so use a new stable workflow key for every distinct retained resume pass. Same-key calls are reused only when launch parameters are identical, and incompatible parameters are rejected. The revived child keeps its stored agent, model, and tool contract. Start a same-role fallback challenge, labeled as fallback, only when no known candidate exists or resume rejects eligibility. `steer` with `mode: "follow_up"` only queues text for the next `resume` when the child has already completed.

### Create an agent

```typescript
subagent({
  action: "create",
  config: {
    name: "my-agent",
    package: "code-analysis",
    description: "Project-specific implementation helper",
    systemPrompt: "Your system prompt here.",
    systemPromptMode: "replace",
    model: "provider/model-id",
    tools: "read,grep,find,ls,bash"
  }
})
```

### Update an agent

```typescript
subagent({
  action: "update",
  agent: "code-analysis.my-agent",
  config: {
    thinking: "high"
  }
})
```

### Delete an agent

```typescript
subagent({ action: "delete", agent: "code-analysis.my-agent" })
```

### Eject, disable, enable, and reset

```typescript
// Copy a bundled builtin/package agent to user scope as an editable custom file.
subagent({ action: "eject", agent: "reviewer" })
subagent({ action: "eject", agent: "reviewer", agentScope: "project" })

// Hide an agent from runtime discovery without deleting it (reversible).
subagent({ action: "disable", agent: "reviewer" })
subagent({ action: "enable", agent: "reviewer", agentScope: "project" })

// Delete the scope's custom agent file and/or settings override, restoring the bundled default.
subagent({ action: "reset", agent: "reviewer" })
```

`eject` copies a builtin or package agent verbatim into the user (default) or project agent dir so it can be customized without hunting package files; the copy shadows the original by runtime name. `disable` writes a reversible `agentOverrides.<name>.disabled: true` entry to the user or project settings file. `enable` removes that `disabled` field while keeping any other override fields. `reset` removes the scope's custom file and settings override to restore the bundled default, and refuses if no bundled default exists (use `delete` for purely custom agents). All four take optional `agentScope: "user" | "project"`; project overrides win over user ones, so target the project scope to undo a project-scope disable.

Use management actions when the system needs to create or edit subagents on
demand without dropping into raw file editing.

Management actions create or update user/project agent files. `config.name` is the local frontmatter name; optional `config.package` registers and looks up the runtime name as `{package}.{name}`. Use the dotted runtime name for `get`, `update`, `delete`, slash commands, and scripted workflow steps. For small agent changes such as a model swap, prefer `subagents.agentOverrides` in settings. Durable `.chain.md` definitions are legacy records, not a current authoring target; use a workflow script file (`workflow: "./path.js"`) or `/prompt-workflow` for repeatable orchestration.

## Creating and Editing Agents by File

A minimal agent file looks like this:

```markdown
---
name: my-agent
package: code-analysis
description: What this agent does
advertise: true
aliases: developer, coder
model: provider/model-id
thinking: high
tools: read, grep, find, ls, bash
systemPromptMode: replace
inheritProjectContext: true
inheritGlobalContext: false
inheritSkills: false
skills: safe-bash, review-checklist
skillPath: ./skills, ../shared-skills
---

Your system prompt here.
```

That is only a starting point. Omit `package` for the traditional unqualified runtime name. Set `advertise: true` only when the parent should receive this agent's name and description before deciding whether to delegate; advertisement is off by default. Common optional fields include:
- `defaultProgress`
- `defaultReads`
- `output`
- `aliases`
- `subagentOnlyExtensions`
- `skills`
- `skillPath`
- `memory`
- `maxSubagentDepth`
- `acceptance`
- `acceptanceRole`
- `async` — single-agent default for background launch (`true`/`false`); explicit tool-call `async` wins
- `timeoutMs` — single-agent default run-level max runtime in ms; opt-in, so without a call, agent, or global config timeout the run is unbounded (tool alias `maxRuntimeMs` is also accepted)

`aliases` is an optional comma-separated or block-list set of alternate names for selecting an agent. Aliases resolve to the canonical `name` for execution, status, persistence, and config. Exact canonical names take precedence over aliases, and alias collisions between distinct canonical agents fail as ambiguous. Management create/update accepts a comma-separated string, string array, or `false`/empty string to clear aliases.

`acceptance` is a single-agent launch default. Use a scalar level such as `checked` or an inline/block YAML map such as `{ level: "none", reason: "lightweight lookup" }`. An explicit tool-call value wins; scripted workflow child acceptance remains configured on the `runs.run` or `runs.all` item. Management create/update accepts the same policy object, and `acceptance: ""` clears the frontmatter default (`false` remains the deprecated disabled-policy shorthand).

`acceptanceRole` is `read-only` or `writer` and controls automatic acceptance inference only. The structured role is authoritative; task wording and agent names do not escalate acceptance. Omission uses lightweight attestation. The field does not grant or revoke tools. Management accepts `false` or an empty string to clear it.

`tools` is a strict child allowlist, not an extension loader. For a named extension tool, keep its registered name in `tools` and load its provider through normal Pi discovery, `extensions`, a path-like `tools` entry, or `subagentOnlyExtensions`. For example, pair `tools: read, fixture_search` with `subagentOnlyExtensions: ./tools/fixture-search.ts` when the provider should exist only in that agent's child sessions. The child now fails with the unavailable names and provider-loading guidance instead of silently continuing when a requested tool is absent; internal `structured_output` is allowed automatically when an output schema requires it.

`skillPath` adds invocation-private skill files or discovery directories relative to the agent file; it does not select them, so list the desired names under `skills`. Local matches win, unresolved or unreadable matches use normal discovery, and local candidates never enter the parent/global catalog. Use `memory: { scope: "project" | "user", path: "<name>" }` for opt-in role-specific durable memory under the dedicated `agent-memory/` namespace; it is separate from parent/session project memory.

For many customizations, builtin overrides in settings are lower-friction than
copying a full builtin file.

## Prompt Template Integration

User prompt templates can delegate into `pi-subagents` through the native `/prompt-workflow` command. This is useful when a slash command should always run through a particular agent or with forked context. Prompt frontmatter can set `subagent`, `model`, `skill`, `cwd`, `fresh`, `fork`, or `inheritContext` for the native adapter.
