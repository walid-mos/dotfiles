# Agents

An agent is a markdown file: YAML frontmatter on top, a system prompt below. The frontmatter defines the specialist that runs as the child session.

```yaml
---
name: scout
description: Fast codebase recon
tools: read, grep, find, ls
---

Your system prompt goes here.
```

## Where agents live

Lowest to highest priority:

| Scope | Path |
|-------|------|
| Builtin | `~/.pi/agent/extensions/subagent/agents/` |
| Installed package | `package.json` `pi-subagents.agents` or `pi.subagents.agents` |
| User | `~/.pi/agent/agents/**/*.md` |
| Project | Project config `agents/**/*.md` (`.pi/agents/**/*.md` in standard Pi) |

Discovery notes:

- Project discovery also reads legacy `.agents/**/*.md` files. If both `.agents/` and the project config agents directory define the same parsed runtime agent name, the project config directory wins.
- Nested subdirectories are discovered recursively. `.chain.md` files do not define agents.
- User and project settings can add extra recursive scan roots with `subagents.agentScanDirs`; fixed user/project agent directories keep higher priority than same-name agents from scan roots.
- Use `subagents.agentExcludeDirs` to prune literal directory subtrees without disabling legacy agents. See [configuration.md](configuration.md#excluded-agent-directories-settings) for path resolution, scope, and exemptions.
- Installed Pi packages can expose agent directories from either `{"pi-subagents":{"agents":["./agents"]}}` or `{"pi":{"subagents":{"agents":["./agents"]}}}` in their package manifest. Package agents load above builtins and below user/project agents.
- Use `agentScope: "user" | "project" | "both"` to control discovery. `both` is the default, and project definitions win runtime-name collisions.

## Builtin agents

Builtins load at the lowest priority, so a user or project agent with the same name overrides them. They do not pin a provider model; they inherit your current Pi default model unless you set `subagents.defaultModel` or `subagents.agentOverrides.<name>.model` (see [models.md](models.md)).

| Agent | Use it when you want... |
|-------|--------------------------|
| `scout` | Fast local codebase recon: relevant files, entry points, data flow, risks, and where another agent should start. |
| `researcher` | Web/docs research with sources: official docs, specs, benchmarks, recent changes, and a concise research brief. |
| `worker` | Implementation work, including approved oracle handoffs. It edits files, validates, and escalates unapproved decisions instead of guessing. |
| `reviewer` | Code review and small fixes. It checks the implementation against the task/plan, tests, edge cases, and simplicity. |
| `oracle` | A second opinion before acting. It challenges assumptions, catches drift, and recommends the safest next move without editing. |
| `delegate` | A lightweight general delegate when you want a child agent that behaves close to the parent session. |

Rule of thumb: `scout` before you understand the code, `researcher` before you trust external facts, `worker` to implement, `reviewer` to check, and `oracle` when the decision itself feels risky.

`oracle` is an advisory reviewer that critiques direction and proposes an execution prompt without editing files. `advisor` is the same bundled role under the Claude Code-compatible name.

### Web research prerequisites

The `researcher` builtin uses `web_search`, `fetch_content`, `get_search_content`, and selective `source_check` validation. Those require [pi-web-access](https://github.com/nicobailon/pi-web-access):

```bash
pi install npm:pi-web-access
```

The provider must be loaded in the child and register all four tools, including `source_check`, before launch; a missing required tool prevents a successful run. Foreground children do not load ambient parent extensions: configure `extensions` or `subagentOnlyExtensions` explicitly, or use background extension discovery as described in [Tool and extension selection](#tool-and-extension-selection). For `researcher`, fetched-source inspection is a fallback for a registered `source_check` call failing, not for missing registration.

## Overriding builtins and custom agents

You can override selected agent fields without copying the whole agent. Overrides live in settings:

- User: `~/.pi/agent/settings.json`
- Project: project config settings file (`.pi/settings.json` in standard Pi)

```json
{
  "subagents": {
    "agentOverrides": {
      "reviewer": {
        "description": "Independent review tier",
        "inheritProjectContext": false
      }
    }
  }
}
```

Supported override fields: `description`, `advertise`, `output`, `outputMode`, `defaultReads`, `model`, `defaultProvider`, `thinking`, `systemPromptMode`, `inheritProjectContext`, `inheritGlobalContext`, `inheritSkills`, `defaultContext`, `acceptanceRole`, `disabled`, `skills`, `tools`, and `systemPrompt`.

- `description` replaces the discovered description for builtin and custom agents, which lets list output show deployment-specific routing or model metadata.
- Use `output: false`, `defaultReads: false`, `defaultContext: false`, or `acceptanceRole: false` to clear an inherited value.
- Use `tools: "inherit"` when that one role should omit its bundled or frontmatter tool allowlist and receive Pi's normal builtins (plus ambient extensions when it runs as a background child).
- Project overrides beat user overrides, except user `model`/`thinking` pins, which stay authoritative (see [models.md](models.md)).
- Matching package, user, and project agents also receive override fields, which replace the same fields declared in their frontmatter. This lets a shared agent keep its persona while local settings choose the effective model, context, tools, or other supported options.

Disable and restore:

- `disabled: true` hides a builtin from runtime discovery and agent-facing `subagent({ action: "list" })` output.
- `subagents.disableBuiltins: true` disables all builtins at once.
- `subagent({ action: "disable", agent: "reviewer" })` writes the override without editing settings by hand; `subagent({ action: "enable", agent: "reviewer" })` removes it.
- `subagent({ action: "eject", agent: "reviewer" })` copies a bundled builtin or package agent verbatim into the user or project agent dir (default `user`) as an editable custom file that shadows the original.
- `subagent({ action: "reset", agent: "reviewer" })` deletes the scope's custom agent file and/or settings override entry, restoring the bundled default. It refuses if no bundled default exists (use `delete` for purely custom agents).

A custom agent file that shadows a bundled agent replaces the bundled definition wholesale; it does not inherit omitted frontmatter, including `acceptanceRole`. Custom implementation profiles must declare `acceptanceRole: writer` explicitly when writer acceptance inference is intended. Without it, automatic acceptance uses lightweight attestation as described in the [frontmatter reference](#frontmatter-reference).

`eject`, `disable`, `enable`, and `reset` accept `agentScope: "user" | "project"` and operate in one scope at a time. Project overrides still win over user ones, so a project-scope disable survives a user-scope `enable` until you target the project scope.

## Parent prompt discovery

Set `advertise: true` in a specialist's agent file frontmatter for parent-prompt discovery, or in `subagents.agentOverrides.<name>.advertise` when the definition must stay untouched. When the `subagent` tool is active, pi-subagents adds an agent-owned catalog of names and descriptions to the parent system prompt. Disabled agents and agents excluded by the current capability ceiling are omitted. Advertisement is not supported through runtime registration.

Advertisement is opt-in discovery, not automatic routing. The catalog is sorted by name and limited to 16 agents and 12,288 total rendered UTF-8 bytes, including XML escaping, instructions, and omission counts. Descriptions are capped at 512 UTF-8 bytes before escaping. Entries that cannot fit are omitted; canonical agent names are never truncated. The parent still calls `subagent({ action: "list", capabilities: true })` before execution to confirm that the selected agent is executable.

The file catalog snapshot refreshes at session start/reload and after extension-owned agent-management mutations. External file or settings edits require `/reload`; ordinary turns do not poll the filesystem. Tool availability is checked in memory on every prompt. A failed management-triggered refresh withdraws the catalog until a successful refresh, without changing the persisted mutation's result.

The catalog is sent as Pi's `advertised_subagents` prompt section. When it changes mid-session, Pi appends it as a small system message instead of changing the system prompt, so the provider prompt cache is kept. This only works if no other loaded extension returns a replacement `systemPrompt` from `before_agent_start`; in that case Pi folds section changes back into the system prompt and the cache is lost for that request.

## Prompt assembly

Subagents are narrow by default. Custom agents start with a clean system prompt and only the context you intentionally give them. They do not automatically inherit Pi's whole base prompt, project instruction files, or discovered skills catalog.

Use these fields when an agent should see more:

| Field | Effect |
|-------|--------|
| `systemPromptMode: append` | Append the agent prompt to Pi's normal base prompt. |
| `inheritProjectContext: true` | Keep inherited repository instructions from files like `AGENTS.md` and `CLAUDE.md`. |
| `inheritGlobalContext: true` | Also keep the operator's global context file from the Pi config agent directory (such as `~/.pi/agent/AGENTS.md`). Defaults to `false`. |
| `inheritSkills: true` | Let the child see Pi's discovered skills catalog. |
| `defaultContext: fork` | Prefer forked session context when a launch omits `context`; if the parent has no persisted session file or current leaf yet, the implicit default falls back to `fresh` without a failed first attempt. Explicit `context: "fork"` remains strict, and explicit `context: "fresh"` still wins. |

Builtin agents opt into repository instruction inheritance by default so they follow repo-specific rules out of the box, but global context remains excluded unless `inheritGlobalContext: true` is set. This changes the behavior of existing agents that previously received global context as part of `inheritProjectContext: true`. `delegate` also uses append mode because its job is orchestration inside the parent workflow.

## Frontmatter reference

A full example:

```yaml
---
name: scout
# Optional: registers this as code-analysis.scout while preserving name: scout
package: code-analysis
description: Fast codebase recon
advertise: true
aliases: explorer, code-scout
tools: read, grep, find, ls, bash, mcp:chrome-devtools
excludeTools: bash
extensions:
subagentOnlyExtensions: ./tools/child-only-search.ts
model: claude-haiku-4-5
thinking: high
systemPromptMode: replace
inheritProjectContext: false
inheritGlobalContext: false
inheritSkills: false
skills: safe-bash, review-checklist
skillPath: ./skills, ../shared-skills
output: context.md
defaultReads: context.md
defaultProgress: true
async: true
timeoutMs: 900000
toolTimeoutMs: 600000
acceptance: {"level":"none","reason":"lightweight lookup"}
acceptanceRole: read-only
interactive: true
maxSubagentDepth: 1
allowNestedSubagents: true
allowedAgents: scout, reviewer
---

Your system prompt goes here.
```

Simple-scalar list fields accept either a comma-separated form or a newline block list with one `- item` per line. This applies to `tools`, `excludeTools`, `allowedAgents`, `defaultReads`, `skill`/`skills`, `skillPath`, `extensions`, and `subagentOnlyExtensions`:

```yaml
tools:
  - read
  - mcp:github/search_repositories
```

Field notes:

| Field | Notes |
|-------|-------|
| `package` | Optional package identifier. A file with `name: scout` and `package: code-analysis` registers as `code-analysis.scout`; serialization keeps `name` and `package` separate. |
| `advertise` | Set `true` to include this agent's name and description in the parent system prompt when the `subagent` tool is active. Defaults to `false`. |
| `aliases` | Optional comma-separated or block-list names that resolve to this agent for selection and explicit `agent` and task inputs. Runtime status, persistence, and config still use the canonical `name`. Exact canonical names take precedence over aliases, and alias collisions between distinct canonical agents fail as ambiguous. |
| `tools` | Strict child tool allowlist. Named extension tools must also have their provider loaded. `mcp:` entries select direct MCP tools when `pi-mcp-adapter` is installed. |
| `excludeTools` | Optional child tool deny-list applied after normal tool resolution. With an explicit `tools` allowlist, matching names are removed; when `tools` is omitted, the names are excluded from the child session's default tool set. Unknown names are ignored by Pi without making the agent definition invalid. |
| `allowNestedSubagents` | Set `true` to authorize the child-safe nested `subagent` runtime without making omitted `tools` an allowlist. Inherited depth and capability ceilings remain authoritative. |
| `allowedAgents` | Restricts which canonical, case-sensitive agent names this agent may launch. Omitted adds no restriction; an empty list denies every descendant launch. This only narrows an existing nesting grant: `tools: subagent` or `allowNestedSubagents: true` is still required. Inherited/runtime allowlists are intersected and cannot be widened. |
| `extensions` | Omitted means a background child loads the parent's ambient extensions; empty means no ambient extensions; list values load exactly those extensions. Foreground children never load ambient extensions, so for them only listed values apply. |
| `subagentOnlyExtensions` | Extension paths loaded only in this agent's child sessions. Tools registered there are unavailable to the main agent unless also installed through normal Pi extension configuration. |
| `model` | Default model. Bare ids prefer the current provider when possible, then unique registry matches. |
| `thinking` | Appended as a `:level` suffix at runtime unless a suffix is already present. |
| `systemPromptMode` | `replace` by default; `append` keeps Pi's base prompt. |
| `inheritProjectContext` | Keeps or strips inherited repository instruction blocks. |
| `inheritGlobalContext` | Keeps or strips the operator's global context file from the Pi config agent directory (e.g. `~/.pi/agent/AGENTS.md`). It has an effect only when `inheritProjectContext` is `true`; otherwise all context files are already disabled. Defaults to `false`. |
| `inheritSkills` | Keeps or strips Pi's discovered skills catalog. For in-process children this includes skills that loaded extensions add. |
| `defaultContext` | Optional `fresh` or `fork` launch-context preference. An implicit `fork` falls back to `fresh` when the parent has no persisted session file or current leaf; an explicit launch `context: "fork"` remains strict. |
| `skills` | Selects specific skills for the child, regardless of `inheritSkills`. |
| `skillPath` | Invocation-private skill files or discovery directories. Relative paths resolve from the agent definition file. Local matches take precedence, while unresolved or unreadable matches fall back to normal skill discovery. This field discovers candidates only; `skills` still selects what the child receives. |
| `output` | Default single-agent output file. |
| `defaultReads` | Files to read before running the agent. |
| `defaultProgress` | Maintain `progress.md`. |
| `async` | Default a single-agent launch to background (`true`) or foreground (`false`) when the call omits `async`. Explicit call values and `forceTopLevelAsync` win. |
| `timeoutMs` | Positive integer opt-in hard runtime deadline in milliseconds for single-agent launches. Runs without a call-level, agent, or global timeout stay alive; inactivity raises attention after two minutes and marks the run stale after ten minutes without stopping it. |
| `toolTimeoutMs` | Optional positive integer hard per-tool-call deadline in milliseconds. An explicit call value wins, then this agent default, global `toolTimeoutMs`, and `PI_SUBAGENT_TOOL_TIMEOUT_MS`. When omitted, known-fast built-in tools get a five-minute default; long-running tools get attention notices but no hard default. It does not extend the run-level deadline; `contact_supervisor`, `intercom`, and `bg_wait` are exempt. |
| `acceptance` | Acceptance default for single-agent launches. Use a scalar level such as `checked` or an inline/block YAML map such as `{ level: "none", reason: "lightweight lookup" }`. Explicit call values win; chain and parallel acceptance remains task/step configuration. |
| `acceptanceRole` | Optional `read-only` or `writer` role for automatic acceptance inference. When omitted, automatic acceptance uses lightweight attestation; task wording and agent names do not escalate it. This does not grant or revoke tools. |
| `mutationTools` | Comma-separated extension tool names treated as mutating activity for runtime diagnostics, long-running-tool status, and timeout recovery. This is diagnostic only and never determines successful completion. List and load each tool through `tools` and its extension provider as usual. |
| `interactive` | Parsed for compatibility but not currently enforced. |
| `maxSubagentDepth` | Tightens nested delegation for this agent's children. |
| `memory` | Opt-in role-specific persistent memory. See below. |

Successful completion is determined by observable gates such as process outcome, required outputs, explicit acceptance, verification commands, independent review, and staged-index integrity. Best-effort mutation observations remain diagnostic: unchanged or unknown evidence does not fail a run, and observed changes do not prove correctness.

## Per-agent persistent memory

A recurring custom agent can opt into a durable, role-specific memory scope with the `memory` frontmatter field:

```yaml
memory:
  scope: project
  path: security-reviewer
```

This is independent of Pi's own parent/session/project memory system and writes nothing to it. Memory lives under a dedicated `agent-memory/` namespace so the two never collide.

How it works:

- On each run, the first 200 lines of `MEMORY.md` in the resolved memory directory are injected into the child system prompt, so the agent can recall accumulated role notes such as threat-model entries, release gotchas, or verified commands.
- Project memory resolves to the main checkout from standard linked Git worktrees whose metadata lives under `<main>/.git/worktrees/`, so isolated children share one durable role memory and worktree cleanup does not remove it. Custom `--separate-git-dir` layouts keep their current project-root behavior because Git does not retain a safely verifiable main-checkout path there.
- Agents with write tools (`edit`, `write`, or `bash`, or no `tools` allowlist at all) are told they may append concise dated entries to the file.
- Agents without write tools receive a read-only memory block and are not instructed to edit it. A read-only reviewer can recall prior notes without gaining write capability.
- The memory directory is never created eagerly. The agent's own `write` tool creates it (and `MEMORY.md`) on the first persist.
- Memory paths are validated against `.`/`..` traversal and symlink escape. An unsafe or unresolvable scope is silently skipped rather than breaking the run.

Scopes:

- Project: resolves under `<project>/.pi/agent-memory/<path>` and travels with the repo.
- User: resolves under `~/.pi/agent/agent-memory/<path>` and is shared across projects for that agent.

## Tool and extension selection

How `tools` behaves:

- `tools` omitted: the child session gets Pi's normal builtin tools.
- `tools` present: regular tool names become an explicit allowlist.
- `tools:` empty: the child session gets no tools.
- `allowNestedSubagents: true`: explicitly enables child-safe nested fanout without turning omitted `tools` into an allowlist. Depth and inherited capability ceilings still apply.
- `allowedAgents: scout, reviewer`: if nesting is separately enabled, restricts this agent's descendant launches to those names. `allowedAgents:` denies all descendants and omission is unrestricted except for inherited policy.

`excludeTools` is applied after this resolution. It can narrow an explicit `tools` allowlist or, when `tools` is omitted, remove names from Pi's default builtin tool set. Runtime-injected tools are excluded only when their exact names are listed. An empty `excludeTools` list has no effect.

An allowlisted name does not load the extension that registers it. Load that provider through `extensions`, `subagentOnlyExtensions`, a path-like `tools` entry, or (background children only) normal Pi extension discovery. Pi's built-in `codemode` is the exception: native children register the host SDK's official factory when codemode is permitted, without enabling it in the main session. On older Pi hosts without that factory, a child that requests codemode still reports it as unavailable; a capability ceiling that denies extensions prevents its registration.

Ambient extensions depend on where the child runs. Local foreground children are sessions inside the parent Pi process and never load the parent's ambient extensions; otherwise the parent would start a second copy of each ambient extension, including this one. Background children are sessions inside the detached runner process and load the ambient extensions unless the agent sets `extensions` or the capability ceiling denies extensions. Local foreground children do inherit the providers the parent's extensions registered (`pi.registerProvider`), so their models resolve without loading those extensions again. Agents that need MCP tools from an ambient adapter such as pi-mcp-adapter (including `mcp:` entries the adapter resolves) must therefore run as background children (`async: true`). A foreground launch of such an agent fails with a diagnostic that says exactly that.

More rules:

- `mcp:` entries are split out and forwarded as direct MCP selections without granting normal builtins unless those builtins are also listed.
- Path-like `tools` entries, such as extension paths or `.ts`/`.js` files, are treated as tool-extension paths rather than tool names.
- Internal runtime tools such as `structured_output` are added to an explicit allowlist only when their contract is active.
- Unknown extension tool calls are treated as mutating diagnostic activity only when their names are listed in `mutationTools`.

Examples:

- `tools` omitted and `extensions` omitted: normal builtins; a background child also loads the ambient extensions.
- `tools: mcp:chrome-devtools`: only the resolved direct Chrome DevTools MCP tools.
- `tools: read, bash, mcp:chrome-devtools`: only `read` and `bash` as builtins, plus direct Chrome DevTools MCP tools.
- `tools: subagent, read`: a child-safe `subagent` tool is available inside that child so it can run explicitly assigned nested fanout.
- `allowNestedSubagents: true` with `tools` omitted: normal builtin tools (and, for background children, ambient extensions) remain inherited, and the child-safe nested `subagent` runtime is added.
- `tools: read, fixture_search` plus `subagentOnlyExtensions: ./tools/fixture-search.ts`: the provider loads only in this agent's child sessions, and the registered `fixture_search` name survives the strict allowlist.

Direct MCP tools require [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter); Pi's built-in MCP is not used for `mcp:` entries. Subagents only receive direct MCP tools when `mcp:` entries are listed in their frontmatter; global `directTools: true` in the adapter's MCP config is not enough by itself. The generic `mcp` proxy tool can still be used for discovery when available. The adapter caches tool metadata at startup, so after connecting a new MCP server for the first time, restart Pi before relying on direct tools. Server `includeTools` and `excludeTools` policies are enforced while resolving cached metadata for children: both accept exact names and `*`/`?` glob patterns against raw, generated-resource, and server/short/mcp/none-prefixed names, with `excludeTools` taking precedence. `mcp:` entries must name servers from the adapter's configuration files; the adapter's `imports` of other tools' MCP configs are not read for subagent children. A server that exists only in the adapter's runtime snapshot (registered at runtime, not persisted) cannot be provided to a child: children are pi sessions inside the parent or the runner process, not `pi` processes that could receive an MCP config argument, so such a launch fails with an error saying that MCP tools must come from an ambient adapter extension in a background child. An `mcp:` entry named `subagent` does not authorize nested fanout; declare the builtin `subagent` tool or set `allowNestedSubagents: true`. If a resolved direct MCP name is missing from the child registry, pi-subagents keeps the launch failed under the strict allowlist and reports the registration mismatch; check the resolved names against what the host or pi-mcp-adapter actually registers before child startup.

`extensions` controls child extension loading:

```yaml
# Omitted: all normal extensions load

# Empty: no extensions
extensions:

# Allowlist
extensions: /abs/path/to/ext-a.ts, /abs/path/to/ext-b.ts
```

When `extensions` is present, normal discovered extensions are disabled. The listed extensions, path-like `tools` entries, required pi-subagents runtime extensions, and `subagentOnlyExtensions` still load.

Use `subagentOnlyExtensions` when a custom extension tool should exist only inside child sessions. It is scoped by agent config: every run of that agent receives those extension paths, while other agents do not unless they declare the same field. The current model does not have a separate named-subagent audience inside one agent definition.

To apply a shared extension policy to every agent that does not declare its own, set `subagents.defaultExtensions` for an ambient-disabling allowlist or `subagents.defaultSubagentOnlyExtensions` for child-only paths that preserve ambient discovery (see [configuration.md](configuration.md)).

Before the first model turn, the child runtime compares every explicit tool name with Pi's final filtered registry. A missing provider fails the run with the unavailable names and concrete `subagentOnlyExtensions`/`extensions` guidance, instead of letting a direct or chained child silently continue without its requested tools.

## Skills

Skills are `SKILL.md` files made available to an agent. The prompt includes skill metadata and the file location; the agent reads the full skill file only when the task matches.

Discovery uses project-first precedence:

1. Project config `skills/{name}/SKILL.md` (`.pi/skills/{name}/SKILL.md` in standard Pi)
2. Project packages and project settings packages via `package.json -> pi.skills`
3. Current task cwd package via `package.json -> pi.skills`
4. Project config `settings.json -> skills`
5. `~/.pi/agent/skills/{name}/SKILL.md`
6. User packages and user settings packages via `package.json -> pi.skills`
7. `~/.pi/agent/settings.json -> skills`

Use agent defaults, override them at runtime, or disable them inside the ```` ```js workflow ```` block:

```js
return runs.all([
  { key: "default", agent: "scout", task: "..." },
  { key: "override", agent: "scout", task: "...", skill: "tmux, safe-bash" },
  { key: "disabled", agent: "scout", task: "...", skill: false },
])
```

For chains, `skill` at the top level is additive. A step-level `skill` overrides that step; `false` disables skills for that step.

Available skills use this shape in the child prompt:

```xml
The following configured skills are available to this subagent.
Use the read tool to load a skill's file when the task matches its description.
When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.

<available_skills>
  <skill>
    <name>safe-bash</name>
    <description>Run shell commands safely.</description>
    <location>/absolute/path/to/safe-bash/SKILL.md</location>
  </skill>
</available_skills>
```

If an agent has an explicit `tools` allowlist and resolved skills, `read` is added for that child run so the listed skill files can be loaded on demand.

Missing skills do not fail execution. The result summary shows a warning.

Agent-local `skillPath` candidates never enter Pi's parent/global skills catalog. Pair `inheritSkills: false` with explicit `skills` and `skillPath` when a child should receive only its selected private skills.

## The bundled pi-subagents skill

The package bundles a `pi-subagents` skill that is automatically available to the parent agent when the extension is installed. Availability is not automatic routing or permission to delegate: the parent works directly unless the operator requests delegation in the current request or through applicable user/project instructions. Once authorized, use the smallest bounded child or workflow whose evidence, independent review, specialization, parallelism, or isolation benefit earns its overhead. It is for the orchestrating parent only: child subagents never receive it, and their context is explicitly filtered to strip parent-only orchestration instructions.

What it covers:

- **Delegation patterns**: how to select a bounded agent and single, parallel, scripted, or async shape after delegation is authorized, including fresh or forked context.
- **Orchestration recipes**: how to apply common techniques directly with `subagent(...)` when the user describes the workflow in natural language. This includes parallel review, review-loop, parallel research, gather-context-and-clarify, parallel cleanup, and staged fix orchestration.
- **Role-agent prompting guidance**: compact contract prompts instead of long scripts, what to include in role-specific meta prompts, and retrieval budgets for researchers.
- **Safety boundaries**: child agents must not run subagents unless their resolved builtin tools explicitly include `subagent`, must not invent intercom targets, and must escalate unapproved decisions.
- **Intercom conventions**: when to ask vs send, and how parent-side supervisor/result delivery works through the native channel.
- **Control and diagnostics**: attention signals, soft interrupts, status, and the `doctor` action.

If you are writing an agent that has been asked to orchestrate subagents, the bundled skill helps it behave correctly without guessing the patterns. If you are a human user, you do not need to read it; the README and the [workflows guide](workflows.md) describe the same workflows in user-facing form.
