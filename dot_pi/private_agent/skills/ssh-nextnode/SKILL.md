---
name: ssh-nextnode
argument-hint: "[project] [command...]"
description: >-
    SSH into a NextNode VPS (user deploy + the nextnode-ci key) via Tailscale,
    resolving the target from the project's nextnode.toml. Use when
    the user runs "ssh-nextnode", asks to "ssh into the VPS", "connect to the
    production server", "regarder les logs sur le serveur", or wants a remote
    shell on a NextNode Hetzner host.
---

# ssh-nextnode — NextNode VPS access

Connect to a NextNode VPS with the mandatory credentials.

## FORBIDDEN / MANDATORY

| FORBIDDEN | MANDATORY |
|---|---|
| User `root` or any other user | User `deploy` always |
| Default SSH key or any identity other than `nextnode-ci` | `-i ~/.ssh/nextnode-ci` always |
| Opening an interactive SSH session from the agent session | Give the user the interactive command to run in their own terminal |
| Guessing the hostname when `nextnode.toml` is absent | Stop and ask which project to target |

**Base command**: `ssh -i ~/.ssh/nextnode-ci deploy@<host>`

## Arguments

- `project` (optional): treated as a project name only if a `nextnode.toml`
  exists at that path or in a sibling directory of that name; otherwise all
  tokens are the remote command.
- `command` (optional): remote command to execute. When omitted, print the
  interactive connection command for the user.

Examples:

    ssh-nextnode                       → resolve VPS for the current project, print the command
    ssh-nextnode docker ps             → run `docker ps` on the current project's VPS
    ssh-nextnode myapp docker logs -f backend → command on myapp's VPS

## Phase 1 — Resolve the Tailscale hostname

1. If no `nextnode.toml` in the current directory and no `project` argument →
   **stop and ask which project to target. Never guess.**
2. Read `nextnode.toml` and resolve the hostname:
   - `[deploy].vps = "xxx"` set → use verbatim (pins a dedicated VPS, e.g.
     `fleurs-prod`).
   - Otherwise use the explicit pipeline environment via `resolveVpsName`:
     `development` → `nn-dev`; `production` → `nn-prod`. Outside a pipeline,
     ask the user to choose development or production before connecting or
     running any remote command; never infer production from a missing value.
   - `[environment].development` in `nextnode.toml` does NOT pick the VPS — it
     only feeds the plan quality matrix. The dev pipeline deploys to `nn-dev`,
     the prod pipeline to `nn-prod`.
3. The resolved hostname is used directly on the tailnet
   (`ssh -i ~/.ssh/nextnode-ci deploy@fleurs-prod`).

## Phase 2 — Connect

- With a command, execute it:

      ssh -i ~/.ssh/nextnode-ci deploy@<tailscale-hostname> '<command>'

- Without one, print the interactive command for the user to run themselves:

      ssh -i ~/.ssh/nextnode-ci deploy@<tailscale-hostname>

## Related skills

- Accor client work: `~/.pi/agent/skills/accor-conventions/SKILL.md` (its §4
  runbook governs the product-data-apps apps; this skill covers NextNode VPSes).
