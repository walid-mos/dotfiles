# Agent docs

Extends step 4 in `SKILL.md`; the stateless gate is not restated here. The general levers for writing to agents, such as pointers, no-ops and positive phrasing, live in `~/.pi/agent/skills/writing-for-agents/SKILL.md`.

## Placement

- **One root `AGENTS.md` for the whole repository.** Add one more per scope whose rules differ, such as a package, a crate or a service, holding only the rules local to that scope. An agent working there loads both.
- **`AGENTS.md` is the only rules file.** Claude Code, pi and Codex all read it, so never add a `CLAUDE.md` beside it. Delete one that only imports `AGENTS.md`.
- **The root `AGENTS.md` also replaces contributor pages.** People read it too, so checks and conventions live there and nowhere else.

## Root AGENTS.md

Open with one line: these are the rules for changing the repository, for people and agents alike, and each scope may add its own `AGENTS.md`. Then write these sections, in this order:

1. **What the project guarantees.** Number the invariants the project must keep, each with its reason, under this line: "A change that weakens one is wrong, even when it compiles."
2. **Architecture rules.** Each is a bold rule followed by why it holds: dependency direction, where IO happens, where composition happens, how failures cross boundaries, who owns options, how external calls are bounded.
3. **Code rules.** Write down the conventions no tool enforces. For the ones a tool does enforce, point to the config file that sets them. Take every rule from the project's configs, its consistent practice or what the user stated. Never invent one.
4. **Checks.** The commands every commit must pass.
5. **Commits.** Granularity and format. Also how to check one commit alone when the project requires each commit to build on its own.
6. **Documentation.** The stateless gate, applied to this repository, followed by the contradiction rule below, word for word.
7. **Working against real systems.** Name what costs money or changes shared state. Say that it needs the user's go-ahead first, and a cleanup afterwards.
8. **Extending.** How to add a plugin, adapter or module, with each step described by role.

The contradiction rule:

> **The docs describe the intended behavior.** That covers `docs/`, the README and the `AGENTS.md` files. When a change makes them wrong, do not just rewrite them to match. First check that the change is expected: the task asks for it, or the user confirms it.
> - If it is expected, update the docs in the same commit as the change.
> - If it is not, the docs win. Bring the code back in line with them, or stop and ask.

## Scoped AGENTS.md

Open with one line on what the scope is. Then add bold rules, each with its reason. Keep only what an agent working there would otherwise get wrong:
- the scope's invariants;
- the traps in its tools;
- the decisions behind its defaults;
- how to test against what it talks to.

## Writing a rule

- Put the rule in bold and the imperative, then its reason in the same bullet. A rule without a reason gets bent the first time it costs something.
- Name code by its role. Leave file names and paths out.
- State values through a pointer, such as "stay within the manifest's `rust-version`".
- Cut any rule that would hold in any project. The agent already follows it by default.
- Check the rule against the code before keeping it. A rule the code breaks is either a bug to report or a wrong rule.
