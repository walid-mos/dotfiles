# Language

The user may write in any language (often French). Unless explicitly requested otherwise, ALL code, comments, and responses MUST be in English.

# Git identity

Never invent or override Git author, committer, or signing identity through command flags, environment variables, config changes, or history rewriting unless the user explicitly authorizes that specific identity change; use the existing configuration unchanged. If identity is missing, conflicting, or suspect, stop and ask—never guess an email from a name or GitHub handle.

# Desktop focus

Never steal desktop focus: run agent-driven browser automation, tests, and benchmarks headlessly, including ad hoc scripts; never switch to headed mode to work around a failure. Open user-requested review surfaces in the background without activation.

For agent-driven frontend browser testing and benchmarks, always use `pi-frontend-check`; load the `frontend-testing` skill for its extension-only policy.

# Tool calls

Always use available dedicated Pi tools for work they support: `read` to read files, `grep` to search contents, `find` for filename/glob matching, `ls` to list directories, `edit` for targeted changes, and `write` to create or replace files. Never bypass a tool refusal by switching to `bash`/`host`, another interpreter, a wrapper, or a contrived pipeline; use the suggested tool or report the missing capability.

Never `sleep` as a way to wait — a fixed delay is a race, not a synchronization (208 such calls have already burned 198 min of wall-clock here). Wait on the real signal: a bounded readiness check on the port/pid/file the work produces, an async subagent (its completion wakes this session), or `bg_wait` for detached work with no native notification. If nothing can finish on its own, do other work or end the turn and come back when it reports. The only `sleep` allowed in a call is a container keep-alive or a planted delay inside a test fixture.

Never block a turn on slow work (test suites, builds, installs): detach it (`setsid nohup <cmd> > /tmp/<name>.log 2>&1 &`) and read the log in a later call, or give the foreground call the timeout it needs — a stuck call stalls the session, and inside a container VM it starves every later call too.

Never re-read a file already in context (67% of reads re-read a known path). Locate with the `grep` tool, then `read` with offset/limit.

Never pour bulk output into context (tool results were 43% of a 542k-token session, re-billed on every turn). `grep`/`tail` the log or redirect it to a file, and extract only what the decision needs.

Two of those rules are enforced, not advised: `extensions/tool-guard` refuses a `bash`/`host` call that blind-waits ≥10s or that does work `read`, `ls`, `grep` or `find` already owns. Re-measure the cost with `node audits/tool-call-audit.ts` (`audits/README.md`).

# Third-party code

Never read dependency internals or build output (`node_modules/**`, `dist/**`, bundles, `*.map`, lockfiles), and never grep across a dependency tree. A precise need is the only exception: state it, then read the package's own `docs/*.md` first and its `.d.ts` declarations second — never its compiled `.js`.

# Harness maintenance

ALWAYS load the `harness-tuning` skill before creating or modifying any skill, Pi extension, or AGENTS.md.

# Plans

Long-lived planning artifacts (roadmaps, multi-phase build plans) live only in `~/.pi/agent/plans/` — read its `README.md` before creating, moving, or closing one; never park plans elsewhere (sessions, repos, loose dirs). `done/` archives are off-context by default: discover via `INDEX.md` and never read archived plans unless explicitly asked.
