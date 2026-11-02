---
name: trust-boundary
description: "Threat model before code for any automation that holds a credential and runs code it does not own: a CI job, a build or deploy step, a hook or plugin host, a script that installs dependencies. Load before writing or reviewing such a job, before documenting a security guarantee of one, and when a reviewer reports a credential leak in one."
---

# Trust boundary

A job that holds a credential and runs project code, its dependencies, its hooks or a config it controls is a boundary. Patching the leak a reviewer found opens the next one. Enumerate the channels first, close them by class, prove each closure with an attack that fails.

## Steps

1. **Write the boundary before the first line of code.** Two columns: the trusted principal (the job, the platform user, the operator) and the untrusted one (project code, its dependencies and lifecycle scripts, its git hooks and config, every file in its checkout). Under them, every credential the trusted side holds and how long it lives.
2. **Walk every channel of the table below** and write, for each, the mechanism that keeps the untrusted side off it. "Not reachable" without a mechanism is a guess.
3. **Close channels by class.** A separate user or a container closes the environment, the process tree and the files at once. Data in JSON files read by a parser closes every shell evaluation at once. Tools run on committed content, named explicitly, close every config lookup at once. A fix that names one variable, one file or one flag is a patch: list its siblings and close the class.
4. **Write the attack before the fix.** For each guarantee, the smallest command the untrusted side would run to break it. Run it on a disposable job: it must fail. Keep it in the pipeline as a probe step, so the guarantee is checked on every change, and name the probe next to the guarantee in the docs. A guarantee with no probe is a claim.
5. **Review before the first push**, with the adversarial review at the highest effort the harness offers, then fix by class again. Fixing finding by finding after the push is how the patch chain starts.

## Channels

| Channel | What the untrusted side does | Closed by |
| --- | --- | --- |
| Inherited environment | Reads the credential from its own environment or a parent's | A separate user, `exec` into the untrusted process, the variables removed before it starts |
| Sourced files | Appends to `BASH_ENV`, a profile or an rc file the trusted shell sources later | Files owned by the trusted user, written only from the pipeline's own text |
| Process inspection | Reads `/proc/<pid>/environ`, the memory or the descriptors of a same-uid process | A separate user: no trusted process ever runs under the untrusted uid |
| Privilege | Passwordless sudo, a setuid helper, a root agent | Root access ended before the first untrusted command, one sudo rule left, to become the untrusted user |
| Config read by a trusted tool | Edits the tool's config in the checkout: a build command, a hook, `core.fsmonitor`, a route | The tool runs on the committed copy kept aside and named explicitly, with the forbidden keys refused when read |
| Tool subprocesses | A trusted tool calls git, npm or a shell, and the untrusted side configures what those run | Read the tool's source for what it spawns; point its git at no repository; no lifecycle script under the credential |
| Shared writable places | Plants a file or a symlink in `/tmp`, a cache or a store the trusted side reads next | The trusted side writes under its own directory, recreated empty before use, never a shared path once untrusted code ran |
| Shell evaluation of data | A value it controls reaches `eval`, an unquoted expansion, a heredoc or a sourced line | Values travel as JSON read by a parser, never as shell text |
| Lookup paths | `PATH`, `HOME`, `NODE_PATH`, `XDG_*`, an `.npmrc` | Set by the pipeline; tools called from the trusted user's own install |
| Output | Prints the credential, a verbose flag, a crash dump with the environment | Values never echoed; logs read as the untrusted side would read them |
| Network | Reaches a metadata endpoint, a local socket, the agent's port | Closed, or named as outside the perimeter in the docs |

## Probe shapes

A probe runs as the untrusted side, through the entry point the real code uses, and passes only when the attack fails:

- read the credential: `env`, `/proc/*/environ`, the trusted user's files;
- escalate: `sudo -n true`, append to a sourced file, write under the trusted directory;
- poison a tool: plant a second config, a build command, a git hook or `core.fsmonitor`, run the trusted tool, check the planted command never ran;
- inject a value: a config value with shell metacharacters, checked to stay literal.
