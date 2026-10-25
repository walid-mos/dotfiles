---
name: project-docs
description: Write or refresh a repository's documentation for people (README, docs/ guides with Mermaid sequence and state diagrams) and for coding agents (AGENTS.md rules per scope), kept stateless so nothing in it goes stale. Use when the user asks to document a project, write or update its README, docs/, architecture docs or AGENTS.md, add diagrams or state machines to its docs, or check that its docs still match the code ("documente le projet", "fais la doc", "mets à jour la doc", "ajoute des AGENTS.md").
---

# Project docs

The code is the only source of truth. People get a README and `docs/` that explain how the project works. Agents get `AGENTS.md` files that state the rules for changing it, and why each rule holds. Both are **stateless**: they carry concepts, flows, states, rules and reasons, never a copy of what the repository already says.

For the Pi harness's own AGENTS.md files under `~/.pi/agent`, load `harness-tuning` instead.

## The stateless gate

Every line passes this test: the code can change without making the line false, unless the change is a change of intent.

A line that restates the repository is a cache (see `~/.pi/agent/skills/writing-for-agents/SKILL.md`, Pruning), and it fails the gate:

| Cache, which fails | Write instead |
| --- | --- |
| A listing of files, folders, modules or packages, or a path into the source | The role of a part ("the module that runs the CLI"), and where new work goes |
| A count ("three crates", "16 diagrams") | Nothing: the reader looks |
| A value copied from code or config: timeout, size, limit, default, version, price, date | What the limit does ("API calls are bounded in time"), plus a pointer to where the value is set (`--help`, the config file) |
| An inventory of the current state: "supports X today", "none yet", "implemented by", "no tests yet" | The rule that holds whatever the inventory is |
| Exact console output | A description of the format, unless the output is the example that teaches it |
| A glossary, or a table of contents of the docs | Each term defined in a few words where it first appears, and each link placed in the prose where a reader needs it |

Two kinds of concrete detail stay, because they are contracts or live nowhere else:
- user-facing names and locations, such as the config file path, the data directory, and flag and key names;
- conventions that no tool enforces.

## Steps

1. **Learn from the code, not from the docs.**
   - Read the manifests, the entry points and the module boundaries.
   - Trace every user-facing command from end to end, and run `--help`.
   - Collect five things: each lifecycle (the states a thing goes through), each guarantee, what each failure leaves behind, each external system with its contract, and each decision with its reason.
   - Existing docs are claims to check, not sources.
2. **Docs describe intent.** Where the code and the existing docs disagree, ask the user which one is intended before writing either. This is the contradiction rule that every root AGENTS.md carries, worded in [agent-docs.md](agent-docs.md).
3. **Write the human docs.** Read [human-docs.md](human-docs.md) first.
4. **Write the agent docs.** Read [agent-docs.md](agent-docs.md) first.
5. **Verify.** Run `node ~/.pi/agent/skills/project-docs/scripts/check-docs.mjs <repo>`. It renders every Mermaid block, checks every relative link and anchor, and lists stale candidates.
   - Fix every error it reports.
   - Judge every stale candidate against the gate. Remove it, unless it is a kept contract or convention.
   - Check every factual claim against the code. Take example output from a real run.
6. **Commit** the docs as `docs:` commits, one intention each.

## Done when

- A reader who has never seen the code can say, after the README and one guide, three things: what each command does, which state a thing can be in, and what a failure leaves behind.
- An agent that reads only the AGENTS.md files on its path can make a change without breaking a guarantee, and knows why each rule exists.
- The check script exits 0, and every stale candidate it lists is either gone or a deliberate contract or convention.
