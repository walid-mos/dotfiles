# Language

The user may write in any language (often French). Unless explicitly requested otherwise, ALL code, comments, and responses MUST be in English.

# Git identity

Never invent or override Git author, committer, or signing identity through command flags, environment variables, config changes, or history rewriting unless the user explicitly authorizes that specific identity change; use the existing configuration unchanged. If identity is missing, conflicting, or suspect, stop and ask—never guess an email from a name or GitHub handle.

# Desktop focus

Never steal desktop focus: run agent-driven browser automation, tests, and benchmarks headlessly, including ad hoc scripts; never switch to headed mode to work around a failure. Open user-requested review surfaces in the background without activation.

For agent-driven frontend browser testing and benchmarks, always use `pi-frontend-check`; load the `frontend-testing` skill for its extension-only policy.

# Harness maintenance

ALWAYS load the `harness-tuning` skill before creating or modifying any skill, Pi extension, or AGENTS.md.

# Plans

Long-lived planning artifacts (roadmaps, multi-phase build plans) live only in `~/.pi/agent/plans/` — read its `README.md` before creating, moving, or closing one; never park plans elsewhere (sessions, repos, loose dirs). `done/` archives are off-context by default: discover via `INDEX.md` and never read archived plans unless explicitly asked.
