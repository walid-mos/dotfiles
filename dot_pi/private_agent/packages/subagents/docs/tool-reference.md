# Tool reference

Parameters and actions for the `subagent` tool. These are what the LLM passes when it calls the tool; most users ask naturally or use slash commands instead.

Call `{ action: "guide", topic: "tool-reference" }` for this reference or `topic: "workflows"` for [workflow recipes](workflows.md). Use `topic: "agents"` for authoring, and `topic: "missions"` for missions. Guide reads do not change the schema or grant authority.

## Execution examples

Chaining is code-driven through a workflow script. Write the script as one ```` ```js workflow ```` fenced block in the reply, then call `subagent({ workflow: true, ... })` in the same reply. A `workflow` string containing `/` is a script file, and any other string is a named resource. `workflowScript` and `workflowScriptPath` were removed; use these forms instead.

Use `await runs.run(...)` for sequential steps and `await runs.all([{ key, agent, task }, ...])` for ordinary parallel fanout. `runs.all` resolves to an ordered array, not a key map, so use indexes, destructuring, or `.map(...)`, not `results.<key>`. Do not read `.output` from an unawaited `runs.run` launch. Stored `runs.run` promises are only for the advanced rolling fanout pattern under [Workflow steering](#workflow-steering), where every promise is later observed with direct `await`, `Promise.race`, or `Promise.all`. Legacy top-level `chain`, `tasks`, and `parallel` inputs are not supported. Helper functions must be plain functions or explicit Promise chains. Nested `async function` helpers, async arrows, and async methods are rejected so child-launch tracking stays portable across Node and Bun. For permission-sensitive host calls, use an extension-owned named resource such as `{ workflow: "run-ci", args: { command: "pnpm test" } }`; raw scripts (`workflow: true` or a script path) have unknown resource provenance and cannot call `runs.host`. A resolved resource may internally use `runs.host(key, { kind: "command", command, timeoutMs, output?, role?, provider? })` within its authority ceiling; there is no per-step `cwd`, and commands and relative output paths use the workflow `cwd`. Set `cwd` on the outer `subagent({...})` request instead, or put a trusted directory change in the command (for example, `cd /path/to/worktree && npm test`).

Use `{ action: "validate", workflow: true }` (or a script path) to check statically decidable syntax and structure without launching children. It returns `{ ok, errors }` and fails the tool call when `ok` is false. Literal child `baseRef` values are checked against the runtime ref policy. Dynamic keys and values remain subject to runtime checks; static validation does not guess them.

Use `workflow: "./path/to/script.js"` to load the same JavaScript statement body from a file. Relative paths resolve against the request `cwd`, and absolute paths pass through. The host reads the file before validation or sandbox execution. The workflow sandbox still has no filesystem access. Missing, unreadable, and empty files fail as file input errors.

Raw reply-block and file-backed scripts accept bounded plain-JSON `args`, including during `validate`. Omitted raw args become `{}`; supplied args are deeply frozen in the sandbox. Normalized args persist in run evidence for diagnosis and exact replay, so never include secrets. Args are data only and do not grant `runs.host` authority.

For permission-extension interoperability, use one of the package-owned named resources with bounded `args` instead of caller-supplied workflow text:

```js
{ workflow: "multi-issue-scout", args: { task: "Investigate these related failures", commonFindings: "Evidence already confirmed", issues: [{ id: "a1", seam: "contracts-runtime", task: "Check config schema drift", files: ["src/config.ts"] }] } }
{ workflow: "parallel-gates", args: { gates: [{ key: "api", task: "Run typecheck", cwd: "/repo/api" }, { key: "ui", task: "Run lint", cwd: "/repo/ui" }] } }
{ workflow: "review", args: { task: "Review the auth flow" } }
{ workflow: "run-ci", args: { command: "pnpm test" } }
```

The host resolves the script and authority internally and records bounded provenance in workflow details and receipts. Every `multi-issue-scout` issue is unique, names exactly one owning seam, and carries concrete `files`; each seam owns at most 6 issues and duplicate ownership is rejected. `run-ci` accepts only `pnpm test` (the default) and `pnpm run typecheck`. Named resources cannot be combined with `agent` or `task`; user/project resource registries are not part of this first slice.

```js
{ workflow: "./workflows/review.js", args: { target: "src/workflows" }, cwd: "/path/to/project" }
{ action: "validate", workflow: "./workflows/review.js", args: { target: "src/workflows" } }
```

Each script below is the ```` ```js workflow ```` block of a reply that then calls `subagent({ workflow: true })`:

```js workflow
// One child; return the child promise explicitly
return runs.run("main", { agent: "scout", task: "Analyze the auth flow" });
```

```js workflow
// Sequential workflow
const scan = await runs.run("scan", { agent: "scout", task: "Analyze auth" });
return (await runs.run("implement", { agent: "worker", task: "Implement from: " + scan.output })).output;
```

```js workflow
// Parallel workflow
const results = await runs.all([
  { key: "backend", agent: "reviewer", task: "Review backend" },
  { key: "frontend", agent: "reviewer", task: "Review frontend" }
]);
return results.map(result => result.output);
```

### Parallel sequential lanes

Use `runs.lanes(lanes)` inside a workflow script when several independent lanes each have ordered stages. This helper composes the existing workflow child runner; it does not add a top-level `lanes` parameter or a second persistence/cleanup system.

See the [staged-lane example](workflows.md#parallel-sequential-lanes) (guide topic `workflows`).

The first stage of each lane is launched by one existing `runs.all(...)` batch. Later stages run in lane order. Set `resume: "previous"` on a later stage to continue the preceding retained child; the helper requires that child’s returned `runId` and delegates to the existing resume checks. Stage keys are local to the lane, and generated child keys are `<lane>.<stage>`.

The complete plain-JSON inventory is validated before the first launch (maximum 32 lanes, 16 stages per lane, 64 total stages, and 64 KiB canonical JSON). A failed, stopped, or detached stage blocks only its lane and marks later stages `skipped`; an explicit `structuredOutput.verdict === "blocked"` has the same effect. Reviewer prose is not parsed. The bounded board returns lane/stage keys, state, `ok`, run ids, explicit output references, bounded errors, and optional verdicts, not transcripts. Use raw `runs.run(...)`/`runs.all(...)` for conditional or rolling workflows.

## Parameter reference

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `agent` | string | - | One direct child or agent-management target. Workflow child agents are set inside `runs.run` or `runs.all`. |
| `task` | string | agent default | Direct child's task; requires `agent`, excludes `action` and workflow inputs. `agent` may also select a management target. |
| `action` | string | - | Offline workflow `validate`, agent management (including `guide` and `children.list`), lane evidence (`lane.status`, `lane.recordMerge`, `lane.recordSupersession`), mission (`mission.create/list/show/update/attach-run/close`), Inspect actions (`inspector.command/open/status/close`), status/control, `worktree.discard`, or doctor action. |
| `topic` | `overview \| workflows \| agents \| missions \| observability \| tool-reference \| configuration \| models \| extension-api` | `overview` | Packaged guide topic for `action: "guide"`. |
| `config` | object/string | - | Agent config for management create/update. |
| `context` | `fresh \| fork \| profile` | global or per-agent default, else `fresh` | Explicit `fresh` or `fork` overrides every workflow child. `profile` requires the selected agent's declared `defaultContext` and ignores config `defaultSubagentContext`; missing agent defaults fail. When omitted, [`defaultSubagentContext`](configuration.md#defaultsubagentcontext) wins over each agent's `defaultContext`; implicit fork falls back to fresh without a persisted parent session and leaf. Explicit fork is strict. Packaged `worker` defaults to `fresh`; packaged `oracle` and `advisor` default to `fork`. |
| `model` | string | agent default | Call `{action:"models"}` first and copy an exact `provider/id`; bare ids resolve only if unique, and agent names are not model ids. A suffix such as `provider/id:high` (`off/minimal/low/medium/high/xhigh/max`) overrides agent thinking. |
| `missionId` | string | - | Attach a workflow to an existing project mission. |
| `mission` | object/false | - | Create a mission and attach this launch with `{ title \| summary, objective?, labels? }`. Set exactly one non-empty `title` or `summary`; `objective` and `labels` are optional. `false` is accepted and creates no mission, the same as omitting it. Explicit mission persistence failures are strict. |
| `handoffPath` | string | - | Aggregate handoff manifest for `action: "worktree.discard"` or lane evidence actions. |
| `mode` | `steer \| follow_up \| auto` | - | Delivery mode for `action: "steer"`. |
| `laneId` | string | - | Exact `runId` stored in the handoff manifest for `lane.status`, `lane.recordMerge`, or `lane.recordSupersession`. |
| `merge` | object | - | Attested merge evidence for `lane.recordMerge`; requires a positive PR number, full reviewed/merge SHAs, tree-equivalence and post-merge-check statuses, attestor, and timestamp. |
| `supersession` | object | - | Attested replacement-lane evidence for `lane.recordSupersession`; requires a different replacement lane id, attestor, and timestamp. |
| `focus` | boolean | false | Focus the newly split host inspector pane for `action: "inspector.open"`; not a standalone action. `inspector.command` is read-only and does not contact Herdr or write a binding. Panes open in the background unless you set `focus: true`. |
| `view` | `fleet \| transcript` | - | Optional `status` view for the active fleet surface or transcript tail inspection. |
| `lines` | number | `80` | Maximum transcript lines for `action: "status", view: "transcript"`; capped at 500. |
| `agentScope` | `user \| project \| both` | `both` | Agent discovery scope. Project wins on collisions. |
| `capabilities` | boolean | `false` | With `action: "list"`, return compact prompt-free rows and `details.agentCapabilities` machine-readable records for each agent's declared/default routing capabilities. |
| `async` | boolean | default-on | Background execution. Workflows default to background. `async:false` blocks the parent until completion. A local foreground child runs inside the parent Pi process and never loads the parent's ambient extensions, but it does inherit the providers those extensions registered. Agents that need MCP tools (`mcpDirectTools`, or MCP tools from an ambient adapter such as pi-mcp-adapter) must run as background children, which load them inside the detached runner process. |
| `chatProgress` | `auto \| off \| live-card` | `auto` | Workflow chat projection. `auto` renders a live in-chat card only for watched foreground workflows in the same Git repository, including managed worktrees; it is off otherwise. Explicit `live-card` requires `async:false` and the same Git repository. Async workflows have no inline live card, so omit `chatProgress` or use `auto`/`off`; use `async:false` only when the parent must block. |
| `isolation` | `none \| worktree` | - | Workflow child isolation. `none` runs in the shared cwd and does not need Git. `worktree` requires a managed Git worktree. Do not combine it with a contradictory `worktree` value. |
| `baseRef` | string | `HEAD` | `HEAD` or a supported named ref such as `refs/heads/release`, `refs/tags/v1`, or `origin/main`. Full 40/64-character commit IDs and revision expressions such as `HEAD~1` are unsupported. The ref must resolve to a commit at worktree allocation; omitted values default to `HEAD` resolved at that time. Source-checkout cleanliness is still checked. For a workflow script, set it on the outer request as a default or on an individual `runs.run`/`runs.all` child to override it. |
| `timeoutMs` / `maxRuntimeMs` | number | none | Optional hard run-level deadline in milliseconds. Both aliases may be supplied only when their values agree. A selected-agent default or global [`timeoutMs`](configuration.md#timeoutms) can supply it, except at the top level of composite async runs (chains, parallel tasks, workflows), which take only the call value; absent all three, runs remain unbounded. Expiration is terminal. Normal inactivity never uses this deadline: two minutes raises attention and ten minutes marks the still-running child stale. |
| `toolTimeoutMs` | number | fast-tool default | Optional positive hard per-tool-call deadline in milliseconds. Precedence: call value → agent frontmatter → config → `PI_SUBAGENT_TOOL_TIMEOUT_MS`. The timer starts on `tool_execution_start`, clears on the matching `tool_execution_end`, and terminates the run with `timedOut: true` if the tool remains open. When omitted, known-fast built-in tools get a five-minute default; long-running tools get attention notices but no hard default. It never extends the run deadline; `contact_supervisor`, `intercom`, and `bg_wait` are exempt. |
| `checkpointBeforeDeadlineMs` | number | none | Async single-agent runs only. The runner requests that the child "checkpoint and stop" this many milliseconds before the run deadline (finish the current tool call, report changed files, build/test state, remaining work, commit/PR state; start no new work). This best-effort steer uses the normal steering lifecycle at the next tool boundary, so the receipt is visible in status and events; the ordinary deadline kill still applies. Precedence: call value → config `checkpointBeforeDeadlineMs`. Disarmed when the deadline leaves under one second before the checkpoint. |
| `toolBudget` | object | none | Optional child tool-call budget `{ soft?, hard, block? }`: `hard` is a positive integer and `soft`, if set, is a positive integer no greater than `hard`. At `soft` the child is nudged to finalize. After `hard`, configured tools are blocked; `block` defaults to `read`, `grep`, `find`, and `ls`, and accepts either a nonempty array of tool names or `"*"` for every tool call. Final assistant text is never blocked. |
| `usageBudget` | object | none | Optional root-only reported-usage budget `{ tokens?: { soft?, hard }, costUsd?: { soft?, hard } }`. Include at least one metric; each `hard` must be positive and each optional `soft` positive and no greater than its `hard`. Soft limits are status-only. Hard limits prevent later child launches after reported usage is reconciled; already-running children are not stopped and no reservations are made. |
| `extensionBindings` | object | none | Child-only plain JSON keyed by namespaces like `package.name/1` (positive version): at most 16 namespaces, nesting depth 16, 256 total object properties, and 16 KiB of canonical UTF-8 JSON. Native Pi launches only; retained resumes reject it. |
| `preflight` | object | none | Advisory lane hints for raw scripts (`workflow: true` or a script path) only; not accepted with named workflows or direct children. See [bounded workflows](workflows.md#opt-in-bounded-workflows). |
| `cwd` | string | runtime cwd | Override working directory. |
| `maxOutput` | object | none | Final output truncation limits `{ bytes?, lines? }`. For child runs it is only applied when set; there is no default cap on the inline path, so use `outputMode: "file-only"` for large outputs. For workflow script results, the Return, Emitted, and Console sections are always capped, at 200 KB / 5000 lines unless `maxOutput` sets other limits. |
| `artifacts` | boolean | true | Write debug artifacts. |
| `includeProgress` | boolean | false | Include full progress in result. |
| `sessionDir` | string | derived | Override session log directory. |
| `acceptance` | string/object/false | inferred | Configure evidence gates. See [Acceptance gates](#acceptance-gates). |
| `gate` | string \| object | - | One host-run verification command, shorthand for `acceptance: { level: "verified", verify: [{ id: "gate", command }] }`. The object form `{ command, output?: "json", schema?, timeoutMs? }` adds a [typed gate](#typed-gates): with `output: "json"`, a passing command's stdout becomes the child's `structuredOutput`. Also valid on individual `runs.run`/`runs.all` items. Rejects `acceptance` except `false` (treated as omitted), rejects retained `resume`, and `output: "json"` rejects `outputSchema`. |

### Budget guidance for writers

As a conservative orchestration policy, do not set a hard `toolBudget` or tight `usageBudget` on implementation workers, fix workers, reviewers with edit authority, or other mutation-capable children. A default tool budget blocks read/search tools rather than mutation tools, and reported usage has no reservation model, so neither tool-call counts nor token/cost totals measure whether a delivery slice is buildable or safe to hand off. Hard caps remain appropriate for explicitly read-only scouts, reviewers, and validators.

Bound writer work with a narrow task. Prefer liveness notices plus `steer` to request a checkpoint after the current tool returns, including changed files, build/test state, remaining work, and commit or PR state. Add `timeoutMs` or `maxRuntimeMs` only when the operator explicitly needs a destructive wall-clock cap; an elapsed timeout is not a mutation-safe boundary and may signal a child during tool work. With an explicit deadline on an async single-agent run, `checkpointBeforeDeadlineMs` automates the checkpoint request.

### Fork context details

Explicit `context: "fork"` fails fast when the parent session is not persisted, the current leaf is missing, or the branched child session cannot be created. By contrast, global `defaultSubagentContext: "fork"` and agent-level `defaultContext: fork` are preferences: when the parent has no persisted session file or current leaf yet, the launch uses `fresh` immediately instead of failing and requiring a retry. Global `defaultSubagentContext: "fresh"` starts fresh. Explicit `context: "fresh"` always wins over both preferences.

When the inherited transcript contains signed Anthropic `thinking` / `redacted_thinking` blocks, `pi-subagents` strips those provider-private blocks from the forked child session: a thinking signature is bound to the session that produced it and cannot be replayed into a branch. The child keeps its requested thinking level and reasons fresh from its first turn; sanitizing the inherited transcript is not a downgrade. Explicit `context: "fork"` never silently downgrades to `fresh`.

In workflow runs that omit `context`, each `runs.run` child follows the global `defaultSubagentContext` when set, then its own `defaultContext`. Without the global setting, a fresh-default worker can run fresh beside a fork-default oracle. If the parent session file or current leaf is not available yet, implicit fork-default children run fresh. Pass explicit `context: "fork"` or `context: "fresh"` when you intentionally want one context for every child.

### Workflow steering

`runs.steer(key, message, options?)` targets a stable key already launched by `runs.run` or `runs.all`. It does not accept a raw run id. Options are `mode?: "steer" | "follow_up" | "auto"`, `index?: number`, and `ackTimeoutMs?: number`. The promise returns `{ key, state, requestId?, deliveryStatus?, targets?, error? }`, where `state` is `queued`, `delivered`, `missed`, or `failed`.

The workflow trace records the attempt and receipt. Always await, return, or include the promise in an awaited standard Promise combinator. Unawaited steering calls reject workflow completion after the side effect settles. `Promise.race` remains the rolling primitive. Foreground children are steered through their in-process session (`steer` and `auto` report `delivered` when that transport accepts the input; `follow_up` reports `queued` when accepted into Pi's queue). Async children use the file control inbox and report correlated consumption by the child, not merely inbox acceptance. Steering recovery is disabled in both cases.

For advanced rolling fanout, keep the launched `runs.run` promises in ordinary JavaScript data only when every promise is later observed with direct `await`, `Promise.race`, or `Promise.all`. `Promise.race` gives the next completed child, `runs.steer` can challenge a still-running keyed sibling, and `Promise.all` collects the rest. No separate `runs.start`, `runs.next`, or `runs.collect` API is exposed.

```js workflow
let pending = [
  { key: "writer", promise: runs.run("writer", { agent: "worker", task: "Draft the fix" }).then((result) => ({ key: "writer", result })) },
  { key: "reviewer", promise: runs.run("reviewer", { agent: "reviewer", task: "Review likely risks" }).then((result) => ({ key: "reviewer", result })) }
];
const first = await Promise.race(pending.map((child) => child.promise));
pending = pending.filter((child) => child.key !== first.key);
const target = pending[0];
const receipt = await runs.steer(target.key, "Use this early review:\n" + first.result.output, { mode: "auto" });
const rest = await Promise.all(pending.map((child) => child.promise));
return { first: first.key, rest: rest.map((child) => child.key), receipt };
```

### Output mode details

Use `outputMode: "file-only"` when a saved output may be large and the parent only needs a pointer. The returned text is a compact reference like `Output saved to: /abs/report.md (48.2 KB, 2847 lines). Read this file if needed.` Failed runs and save errors still return normal inline output for debugging.

In a workflow script, give each child an explicit output path when later script steps need a durable file reference. A child with only read-only tools does not need direct filesystem access for `output`: it returns the complete artifact in its final response and the runtime persists it. Children with mutation-capable tools retain the direct-write instruction.

The `output` field is the API binding; a filename mentioned in task text (for example, `Write your findings to exactly this path: report.md`) is only instruction and does not override runtime routing. When a later workflow step or parent needs a durable file, set `output` on `runs.run`/`runs.all` and return the child’s `outputReference`, `outputPathMapping`, or `artifactPaths`; arbitrary literal strings returned by workflow JavaScript are not rewritten. Omitted child output may use a managed aggregate-derived sibling path.

### Retained children

Completed workflow children from the current parent session stay addressable as retained children. `{ action: "children.list" }` lists up to the last 10 with their run ids and explicit `resumable` or `not resumable` state. This workflow-only roster is not an exhaustive list of direct native children. Resume only rows reported `resumable`. When the exact run id of an intended direct child is known, inspect it with `{ action: "status", id: "<run-id>" }`; if status identifies the candidate, attempt `{ action: "resume", id: "<run-id>", message: "..." }`. Resume performs the authoritative eligibility check and may reject the attempt. Start a same-role fallback challenge, labeled as fallback, only when no known candidate exists or resume rejects eligibility. A later workflow continues a resumable child by passing `resume` instead of `agent`:

```js workflow
let writer = await runs.run("implement", { agent: "worker", task: "Implement the accepted contract" });
for (const pass of [1, 2]) {
  if (!writer.runId) throw new Error("writer did not return a retained run id");
  writer = await runs.run("followup-" + pass, { resume: writer.runId, task: "Revisit pass " + pass + ": " + writer.output });
}
return writer;
```

Each workflow key identifies one result lane. Use a new stable workflow key for every distinct retained resume pass; same-key calls are reused only when launch parameters are identical, and incompatible parameters are rejected.

Inside a workflow script, `await runs.run(key, { resume, task })` waits for the revived child to finish and returns its completed output and new `runId`. Each resume can return a new retained run id, so loops must continue from the latest returned `runId`. Top-level `{ action: "resume" }` remains detached and returns a background-run receipt. When it revives a failed async workflow child (or a failed revival of one), the revived run becomes that key's latest run: workflow `status` adds `Revived → <run>: <state>` under the key, and keyed `resume: { workflowRunId, key, latest: true }` continues from it with lineage `[original, revived, ...]`. If the workflow was still running, the receipt it writes when it ends adds the revived runs to the key's lineage, and its completion notice keeps the child's failed result with the same `Revived →` line. The workflow's return value and state are not changed, notices already delivered are not rewritten, and a key accepts at most 16 chained revivals. Reviving a completed, paused, or stopped child does not change its key.

For a simple implementation challenge outside a workflow script, send the challenge through `subagent({ action: "resume", id: "<retained-writer-run>", message: "Reconsider the implementation and make any better current-scope change." })` when `children.list` reports that retained writer as `resumable`, or attempt it after exact-id status inspection identifies a known direct-child candidate. Status is advisory; resume authoritatively checks eligibility and may reject missing recovery requirements. If there is no known candidate or resume rejects eligibility, start a same-role fallback challenge and record why it is a fallback. Use workflow `runs.run({ resume })` only when the script must await the revived writer output before the next step. Do not use `steer` as the sole challenge action for a completed retained child; `steer` with `mode: "follow_up"` only queues text for the next `resume`.

`resume` and `agent` are mutually exclusive. The revived child keeps its stored agent, model, and tool contract. `gate` is rejected on retained resume items because resume uses the retained child contract.

## Management actions

### Guide

`{ action: "guide" }` reads the packaged `README.md` from the installed version. Pass `topic` to read its packaged `docs/<topic>.md` file instead; see the `topic` parameter table for valid values.

Agent definitions are not loaded into context by default. Management actions let the LLM discover, inspect, create, update, and delete agents at runtime. An unknown action returns safe next steps (`status` and `list`) and may suggest a close non-destructive action. Destructive actions are only named for a near-complete one-character typo, and suggestions never execute an action.

```ts
{ action: "list" }
{ action: "list", agentScope: "project" }
{ action: "list", capabilities: true }
{ action: "get", agent: "scout" }
{ action: "models" }
{ action: "models", agent: "reviewer" }
{ action: "get", agent: "code-analysis.scout" }

{ action: "create", config: {
  name: "Code Scout",
  package: "code-analysis",
  description: "Scans codebases for patterns and issues",
  scope: "user",
  systemPrompt: "You are a code scout...",
  systemPromptMode: "replace",
  inheritProjectContext: false,
  inheritGlobalContext: false,
  inheritSkills: false,
  model: "anthropic/claude-sonnet-4",
  tools: "read, bash, mcp:github/search_repositories",
  extensions: "",
  skills: "parallel-scout",
  thinking: "high",
  acceptance: { level: "none", reason: "lightweight lookup" },
  acceptanceRole: "read-only",
  output: "context.md",
  reads: "shared-context.md",
  progress: true
}}


{ action: "update", agent: "code-analysis.scout", config: { model: "openai/gpt-4o" } }
{ action: "update", agent: "code-analysis.scout", config: { acceptance: "" } } // clear the frontmatter default
{ action: "update", agent: "code-analysis.scout", config: { acceptanceRole: false } } // restore default lightweight attestation
{ action: "delete", agent: "scout" }

{ action: "eject", agent: "reviewer" }
{ action: "eject", agent: "reviewer", agentScope: "project" }
{ action: "disable", agent: "reviewer" }
{ action: "enable", agent: "reviewer", agentScope: "project" }
{ action: "reset", agent: "reviewer" }
```

Rules:

- `capabilities: true` changes `action: "list"` to compact one-line rows and adds `details.agentCapabilities: { agents }`. Each agent row includes source, aliases, tools, MCP direct tools, mutation tools, model/thinking, default async/timeout, declared acceptance policy/role, output path/mode, and skills/extensions. It never includes an agent's system prompt. Rows show declared/default capabilities, not successful launch; launch resolution remains authoritative.
- `create` uses `config.scope`, not `agentScope`.
- `config.name` is the local frontmatter name; optional `config.package` registers the runtime name as `{package}.{name}` and is saved as separate `name` and `package` frontmatter.
- `config.aliases` accepts a comma-separated string, string array, or `false` to clear aliases. Aliases resolve to the canonical agent name for execution and are shown by `list`/`get`.
- `update` and `delete` use the runtime name and `agentScope` only when the same runtime name exists in multiple scopes.
- To clear optional string fields, including `package`, set them to `false` or `""`.

`eject`, `disable`, `enable`, and `reset` are described in [agents.md](agents.md#overriding-builtins).

## Lane merge evidence and cleanup eligibility

Lane evidence actions update an existing parallel handoff manifest at an explicit update boundary. They do not verify GitHub state, run Git commands, or remove worktrees. Pass the manifest path and its exact `runId` as `laneId`:

```ts
subagent({
  action: "lane.recordMerge",
  laneId: "<manifest-run-id>",
  handoffPath: "/path/to/handoff.json",
  merge: {
    prNumber: 123,
    reviewedHead: "<40-character-sha>",
    mergeCommit: "<40-character-sha>",
    treeEquivalent: true,
    postMergeChecks: "recorded",
    attestedBy: "operator",
    attestedAt: "2026-08-27T16:23:00.000Z"
  }
})
subagent({
  action: "lane.recordSupersession",
  laneId: "<manifest-run-id>",
  handoffPath: "/path/to/handoff.json",
  supersession: {
    supersededBy: "<replacement-lane-id>",
    attestedBy: "operator",
    attestedAt: "2026-08-27T16:23:00.000Z"
  }
})
subagent({ action: "lane.status", laneId: "<manifest-run-id>", handoffPath: "/path/to/handoff.json" })
```

The manifest stores one of these fail-closed eligibility states: `active` (an owning child is still running), `terminal-eligible` (complete merge evidence and recorded post-merge checks), `terminal-blocked` with a reason, `superseded-eligible` (an explicit replacement attestation), or `unknown` (missing or malformed evidence/manifest). Each attestation stores a digest of the manifest facts it covered; later group, worktree, or patch changes downgrade that evidence to `terminal-blocked` until it is recorded again. A terminal update recomputes a previously stored `active` state from the current child statuses and evidence. Conflicting reviewed heads and mismatched lane ids are rejected as stale. Existing workflow receipts remain immutable.

`lane.status` renders the stored state and, when the state is neither `active` nor `unknown`, a copy-pasteable `worktree.discard` invocation. It never runs that invocation; `worktree.discard` still goes through the `discardWorktree` authority decision. Remote branch deletion and extension-side GitHub verification remain out of scope.

## Status and control actions

### Failed lane recovery and execution-mode boundaries

A failure in the subagent workflow, child launch, prompt runtime, extension loading, or child tooling setup is a lane infrastructure blocker, not permission to silently change execution mode. Stop and report the exact failure, run/status, and repo/cwd/worktree/branch/ref state. Before a same-protocol retry or asking the owner, verify the worktree is clean or capture the partial diff. Retry or fix the `subagent` path only through a clear same-protocol action.

For backlog lanes and other subagent-governed workflows, external/foreground/CLI fallback requires explicit owner approval. Do not silently switch to `interactive_shell`, `pi -ne`, Codex/Claude/Cursor CLI, a foreground agent, or another external mode. `interactive_shell` remains valid when the user explicitly requests visible foreground/CLI work or the task is outside the governed subagent protocol. Pi core may print a generic `pi -ne` extension-load hint; that out-of-repo hint is not protocol-approved fallback. A verified compaction abort may continue the retained child once on its already resolved model; it never selects another model.

```ts
subagent({ action: "status" })
subagent({ action: "status", view: "fleet" })
subagent({ action: "status", id: "<run-id>" })
subagent({ action: "status", id: "<run-id>", view: "transcript", index: 0, lines: 80 })
subagent({ action: "status", id: "<nested-run-id>" })
subagent({ action: "interrupt", id: "<run-id>" })
subagent({ action: "interrupt", id: "<nested-run-id>" })
subagent({ action: "stop", id: "<run-id>" })
subagent({ action: "resume", id: "<run-id>", message: "follow-up question after it pauses or finishes" })
subagent({ action: "resume", id: "<run-id>", index: 1, message: "follow-up for child 2" })
subagent({ action: "resume", id: "<nested-run-id>", message: "follow-up for a nested child" })
subagent({ action: "steer", id: "<run-id>", message: "guidance for the running child" })
subagent({ action: "steer", id: "<run-id>", mode: "follow_up", message: "check this after the current turn" })
subagent({ action: "steer", id: "<run-id>", index: 1, mode: "auto", message: "guidance for child 2" })
subagent({ action: "doctor" })
```

### status

`status` resolves exact foreground ids, top-level async ids, and nested run ids before falling back to prefix matching.

- `view: "fleet"` is an optional read-only active-run surface with transcript commands; it does not add steering or stop controls.
- `view: "transcript"` tails the selected run's live `output-<index>.log` or persisted session transcript, with `lines` capped at 500.
- Nested status shows the root/parent path, nested children, session/artifact paths when known, and nested control commands.
- Inside child-safe fanout mode, bare `status` requires an id when no local foreground run is active, so children cannot enumerate unrelated top-level async runs.
- Bare `interrupt` still targets only the visible top-level run; interrupting a nested run requires its explicit nested id.

### resume

`resume` revives a paused, completed, or failed async/foreground child by starting a new child from its stored session file. Stopped runs remain non-resumable, and it does not interrupt a live top-level async child. Use `steer` for acknowledged live async guidance.

- Multi-child async runs and remembered foreground single, parallel, or chain runs can be revived by passing `index` to choose the child.
- Nested runs can be resumed by nested id when their live route or persisted nested session metadata is available.
- Revive starts a new child session from the old session context; it does not resume the live session, and it requires the chosen child to have a persisted `.jsonl` session file.
- Direct revival takes an exclusive cross-process lease on the canonical session file until the new child finishes. A concurrent attempt fails before Pi is spawned and identifies the owning revived run; dead-owner leases are reclaimed only when staleness can be proved.

### stop

`stop` ends a current-session top-level async run. It is deliberately stronger than `interrupt`:

- It is not a resumable pause; stopped runs should be restarted as new runs.
- Foreground and nested targets are rejected.
- Direct id calls execute immediately.
- `subagent({ action: "stop", id })` stops a run directly; the Fleet inspector's `D` stops the selected run after confirmation.
- Pass a child id to stop one child of a multi-child async run or workflow while the rest continue: `subagent({ action: "stop", id, childId })`. Child ids come from status output or the async status snapshot. Only pending or running children are stoppable; the request is rejected for anything else instead of widening to a run-level stop.

### steer

`steer` waits up to three seconds for a correlated receipt and returns a request id with `delivered`, `scheduled`, `pending`, `partial`, `recovered`, or `failed` plus per-child states. The receipt also has `deliveryStatus: "delivered" | "queued"`. For async runs, delivery means the child consumed the correlated user input; foreground delivery means the in-process Pi transport accepted it. Neither means model compliance. A pending indexed child returns `scheduled`.

The optional `mode` is `steer` by default and keeps the current interrupt behavior. `follow_up` waits for the next turn boundary. `auto` uses the same native steer delivery path as `steer`, without automatic pause-and-revive recovery after a missed acknowledgment. The retained revival-brief queue holds 20 messages and returns a clear error when full; this is not a live follow-up queue bound. A live follow-up acknowledgment reports queue acceptance, not consumption. Async runs later record correlated consumption or fail unconsumed requests at settlement; foreground follow-ups have no later correlated receipt. A `follow_up` sent to a completed retained workflow child becomes the first brief for its next `resume`; it does not revive the child by itself.

Only a top-level single run may interrupt after the acknowledgment deadline and recover after a further 15-second pause/revival bound; durable multi-child and nested runs never auto-interrupt. Recovery launches a replacement only after the source is confirmed paused, a valid persisted session exists, and deadline, turn, and tool budgets remain. It preserves the original child contract and remaining limits; otherwise the source stays paused with an explicit failure. Late acceptance is recorded but cannot cancel committed recovery.

The persisted `steering` ledger retains 20 requests and replaces the old `steerCount`/`lastSteerAt` fields.

`subagent({ action: "steer", id, index, message })` is the host bridge for non-TUI sessions and RPC hosts. `index` accepts the stable child identity shown in status output and inspect replies (workflow key, child run id, or `step:<index>`) and resolves it to the child index before steering; unknown or ambiguous child ids fail closed.  The bridge always disables pause-and-revive recovery (`steeringRecovery: false`) so the caller keeps authority over the exact child it addressed.

## Acceptance gates

Every run resolves an effective acceptance policy. Callers may omit `acceptance` for the inferred default, or set it on single runs, top-level parallel task items, chain steps, and static parallel tasks.

Checked writers reject staged files by default. When a parent intentionally starts a single writer with reviewed staged content, opt in with `acceptance: { level: "checked", preserveStagedIndex: true }`. The host captures the repository-wide index tree immediately before each launch (including each retained resume) and accepts only if `git write-tree` produces the same tree at completion. Working-tree-only fixes are allowed; child-created staging is rejected. Capture or terminal Git failures, including an unavailable or unmerged index, fail closed. This option does not stage or restore files and should not be used for concurrent writers sharing one worktree.

Prefer an inline JSON object. JSON-encoded object strings are tolerated only during input normalization; invalid strings fail closed. `true` is invalid. Supported evidence kinds are `changed-files`, `tests-added`, `commands-run`, `validation-output`, `residual-risks`, `no-staged-files`, `diff-summary`, `review-findings`, and `manual-notes`. For example: `{level:"checked",evidence:["commands-run","changed-files"],review:{required:true}}`. Evidence levels end at `verified`; independent review is a separate gate, not a stronger evidence level.

```ts
{
  agent: "worker",
  task: "Implement the fix",
  acceptance: {
    level: "verified",
    criteria: ["Patch the bug without widening scope"],
    evidence: ["changed-files", "tests-added", "commands-run", "residual-risks", "no-staged-files"],
    verify: [{ id: "focused", command: "npm test", timeoutMs: 120000 }]
  }
}
```

### One-command gates

When one host-run command is the entire verification contract, use the `gate` shorthand instead of a full `acceptance` object:

```js workflow
return runs.run("impl", { agent: "worker", task: "Implement the fix", gate: "npm test" });
```

`gate` normalizes to verified acceptance with that single command, so the runtime executes it on the host and records the result as evidence. Verification results are memoized per tracked workspace state and effective environment, so an unchanged tree does not rerun the same command. Use explicit `acceptance.verify` when you need multiple commands, timeouts, or custom criteria. `gate` rejects `acceptance` except `false` (treated as omitted), and rejects retained `resume` items. With `worktree: true`, the gate runs inside the child's managed worktree.

### Typed gates

A gate given as `{ command, output: "json" }` runs like a string gate, and then parses the command's stdout:

```js workflow
return runs.run("review", {
  agent: "reviewer", task: "Review the change", output: "reports/review.md", outputMode: "file-only",
  gate: { command: "classify --report reports/review.md", output: "json",
          schema: { type: "object", properties: { verdict: { enum: ["ok", "blocked"] } }, required: ["verdict"] } }
});
```

- The command runs after the child's output file is saved, in the child's cwd or managed worktree, so it can read what the child wrote.
- A passing command must print one JSON document on stdout (at most 12,000 characters). The parsed value becomes `result.structuredOutput`, is recorded on the verify run as `structuredOutput`, and is projected into `status.json`. When `schema` is given, the value must validate against it.
- Empty, truncated, non-JSON, or schema-invalid stdout marks the gate `failed` with a `structuredOutputError`; explicit acceptance then fails the run, exactly as a non-zero exit would. The verdict is never silently dropped.
- Typed gates are never memoized: their input (a report, a log) can change without the tracked tree changing.
- `output: "json"` cannot be combined with an `outputSchema` from any source: the launch `outputSchema` param or the agent's frontmatter, paired with `gate`, an explicit `acceptance.verify` entry, or the agent's `defaultAcceptance`. Preflight rejects the launch and names both sources. A child has exactly one structured-output source.
- `runs.lanes` treats a bridged `structuredOutput.verdict === "blocked"` like any other blocked stage. Scripts read the value as `result.structuredOutput`.

### Levels and inference

Acceptance evidence levels are `auto`, `none`, `attested`, `checked`, and `verified`. `acceptance: "auto"` is the default.


Agent frontmatter or `subagents.agentOverrides` may set `acceptanceRole`. The role affects acceptance inference only and does not change tool access. Review is a separate gate configured with `acceptance.review`.

Edge cases:

- The bare string `"none"` is rejected; use `{ level: "none", reason: "..." }` instead.
- `acceptance: false` is accepted only as a deprecated shorthand for disabling gates.
- For reviewer/read-only calls, omit `acceptance`.
- The explicit value `"reviewed"` is not a policy level: it remains schema-recognized only so semantic preflight can explain the mistake without spawning a child. To require review of a writer result, use `acceptance: { level: "checked", review: { required: true, agent: "reviewer" } }` and orchestrate the reviewer separately.
- With `agentContract: { version: 1 }`, omitted, `"auto"`, and `false` mean no acceptance request for that run; explicit acceptance is reported separately from execution.

### Evidence status

Acceptance provenance is stored separately from child prose. `evidenceStatus` preserves evidence progress when the overall status is waiting on or has completed review:

- `claimed`: child finished but did not provide structured evidence.
- `attested`: child returned a structured acceptance report.
- `checked`: runtime structural checks passed, such as required evidence and no staged files.
- `verified`: configured runtime verification commands passed. Child-reported command success does not count.
- `review-required`: independent review is pending, or invalid/missing acceptance evidence must be repaired in a retained child session. Inspect `evidenceStatus` and `recovery` to distinguish them.
- `reviewed`: an independent reviewer result is present and has no blockers.
- `rejected`: attestation, structural checks, verification, or review failed.

### The acceptance report

For `attested` or stricter levels, the child prompt includes a standardized acceptance section and asks for a fenced `acceptance-report` JSON block. Reviewer/read-only inference resolves to `none`, so it does not add this section; explicit acceptance still does. With `outputSchema`, set `acceptance.report: "on"` to require the same report in the final `structured_output` call, or `"off"` to keep the fenced-report path. Omitting `report` preserves the default behavior. Runs without `outputSchema` never gain a standalone structured-output tool from this option.

The parser canonicalizes known enum synonyms, snake_case report keys and wrappers, underscore fence tags, unambiguous scalar arrays, string booleans, and criterion-id separators. Unknown or ambiguous keys and enum values fail with field-level diagnostics. Explicit empty `changedFiles` and `testsAddedOrUpdated` arrays are recorded as not applicable; missing fields and empty required command or validation evidence still fail.

Acceptance fences are removed from normal output artifacts, while the raw child transcript remains intact and per-child metadata stores the complete acceptance ledger and parsed report. Explicit failed gates fail the run. Inferred gates remain observable without failing the run.

A malformed or missing required report never becomes accepted evidence. When a child completed successfully, its acceptance can fail the run (explicit acceptance, or an `agentContract` step with `gateOn: "acceptance"`), and its exact session is retained, the ledger keeps `evidenceStatus: "rejected"` but returns `status: "review-required"` with `recovery: { status: "resume-required", reason: "acceptance-report-invalid", sessionFile }`. A failed staged-index check keeps the ledger `rejected` instead. Foreground progress and the affected async step become paused/needs-attention, and an async parent becomes partial; chains and parallel groups stop at the paused step. Resume that run lineage to emit corrected evidence rather than replaying implementation work in a fresh child. Scripted workflows block later mutation launches until `runs.run` resumes the exact retained run id (`resume: "<runId>"`) successfully; an explicit read-only review child with `acceptance:false` remains allowed. Without a retained session, invalid evidence is terminal `rejected`.
