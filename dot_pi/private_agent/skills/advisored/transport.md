# Advisor transport

Extends Lifecycle in `SKILL.md`: the command behind each step and what it guarantees. Run every command as `node ~/.pi/agent/skills/advisored/scripts/advisor.ts <command> ...`. Results are JSON on stdout, diagnostics on stderr. Exit codes: 0 accepted, 1 reply rejected (saved anyway) or delivery not approved, 2 precondition or usage error, 3 advisor process failed.

## Scope options

`--repo <dir>` (default: current directory) names the git work tree whose `HEAD` and `git status` paths (untracked included, both sides of a rename) define the fingerprint and the recorded diff. `--path <file>` adds a file outside the work tree to the fingerprint and can repeat. Outside a git work tree `--path` is mandatory and no diff is recorded. `fingerprint`, `run-check` and `send` take the same scope options; use the same values throughout one task. `verify` reuses the scope recorded with the `READY` round.

## Commands

| Step | Command | Guarantees |
| --- | --- | --- |
| Open | `init --request <file> [--backend claude\|pi] [--model <selector>] [--effort <level>] [--cwd <dir>]` | Private `mktemp` directory (mode 700, outside the repository) holding the frozen `advisor.md` and its SHA-256, `request.md`, the seeded `ledger.md`, `state.json`, and empty `packets/`, `replies/`, `evidence/`. Without `--backend` and `--model`: Pi with `openai-codex/gpt-6.1-sol:high` when `CLAUDECODE` is set in the environment (you run in Claude Code), Claude Code `opus` at effort `xhigh` otherwise. `--model` alone selects Pi. A Pi selector is resolved to one exact `provider/model` through `pi --list-models` and its credentials checked with `pi auth check` before anything is recorded; an ambiguous or unknown selector lists the candidates and stops. |
| Any time | `fingerprint [scope] [--manifest]` | Prints the 16-hex fingerprint; `--manifest` prints the hashed lines (mode and content hash per path). |
| Implement | `run-check <state_dir> [scope] [--timeout-ms <n>] -- <command...>` | Runs the command in the task `cwd` without a shell and records command, cwd, outcome, timestamps, the fingerprint before and after the run, stdout and stderr (last 256 KiB each) under `evidence/`, with the file's SHA-256 stored in `state.json`. Exit 0 means recorded; the check's own result is in `outcome` and `exitCode`. |
| Any round | `send <state_dir> --checkpoint <LABEL> --body <file> [scope] [--timeout-ms <n>]` | Refuses when the frozen contract changed or a recorded evidence file was edited. Computes the fingerprint, assembles the packet (header, then recorded request, ledger, previous reply, per-file diff of the changed paths, every check recorded since the previous accepted round, then your body), saves it, launches one fresh advisor process with the frozen contract as system prompt, saves raw output and stderr, and accepts the reply only when the process exited 0, the model is the pinned one (Claude: one `modelUsage` entry, pinned from round 1; Pi: every `model_change` in the round's session file equals the resolved model), and the first line carries a verdict echoing the packet's fingerprint and checkpoint, with `READY` only on `FINAL`. Accepted rounds are appended to `state.json`; a failed or rejected attempt keeps its files and the retry gets a `-retryN` suffix. |
| Deliver | `verify <state_dir>` | Recomputes the fingerprint with the last round's scope and exits 0 only when that round is `READY` on `FINAL` and the values match. |
| Receipts | `status <state_dir>` | Rounds with verdict, fingerprint and cost (Claude), evidence count, the contract check, the ledger path. |

`--cwd` fixes the directory the advisor process and every `run-check` run in. `--effort` (Claude) and the `:thinking` suffix (Pi) set the advisor's reasoning level.

An advisor round takes minutes: run `send` with the Bash tool's `foregroundMs` at its maximum, so the call stays open until the reply at no token cost. A round that outlives the window becomes a job: end the turn, its completion notification resumes you with the reply; never poll it. A running job is not a reply, and a rejected reply (exit 1) is saved under `replies/` for inspection but counts as no answer.

## What the script never decides

Whether the scope covers the reviewed material (pass `--path` for files outside the work tree), which checks to run, whether a finding is closed, and whether to escalate. Those stay with you and the ledger.

## Recorded diff limits

A file whose diff exceeds 64 KiB, or whose path looks like a secret store (`.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, a name containing `secret` or `credential`), is listed with the reason and its diff body omitted; the fingerprint still covers it. Keep secret files out of the changed tree (gitignored) before sending.

## Backend notes

- Every round is a fresh process: the advisor's memory is the recorded ledger and its previous reply inside the packet, not a growing conversation. Each round's context stays bounded and a failed round is a plain resend.
- Claude Code runs with `--safe-mode --tools '' --disallowedTools 'mcp__*' --strict-mcp-config --setting-sources '' --no-session-persistence` and `--system-prompt-file`: no tools, no MCP, no project customization, nothing written under `~/.claude/projects`. Admin-managed policy still applies. Stop if it defeats these restrictions.
- `--bare` is not a substitute for safe mode: it switches authentication to API keys and bypasses the user's OAuth login.
- Pi runs with `--no-tools` and every discovery flag off (`--no-extensions --no-mcp --no-skills --no-prompt-templates --no-context-files --no-approve`). Each round writes one session under `<state_dir>/pi/`, read only to confirm the model, and prints a "creating a new session" warning on stderr, which is expected.
- These flags restrict the model's tools, not the CLI process's operating-system access.

## Failure and recovery

Exit 3 means the process failed: read `replies/<round>.stderr.txt`, fix the cause (authentication, network, missing CLI), and resend the same packet. Exit 1 on `send` means the reply did not validate: read it under `replies/`, then resend the same packet. Exit 2 is a blocker, not an approval: a changed contract, an edited evidence file or a `state.json` this script does not recognize. Report it; never substitute another model or launcher silently, and never edit `state.json` or `evidence/` by hand.
