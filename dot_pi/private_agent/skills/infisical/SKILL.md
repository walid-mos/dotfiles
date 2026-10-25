---
name: infisical
description: >-
  Infisical vault operations from this machine: which identity acts (the pi MCP's
  machine identity versus the user's CLI session), creating projects and
  environments through the REST API so the user owns them, and writing secret
  values without exposing them. Load whenever a task touches Infisical in any
  repository: a project, an environment, an identity, a secret, the `infisical`
  CLI or the `@infisical/mcp` server.
---

# Infisical

## Two identities, nothing shared

- **pi MCP** (`@infisical/mcp`, launched by pi): authenticates with the Universal Auth machine identity whose `INFISICAL_UNIVERSAL_AUTH_CLIENT_ID` and secret live in the shell environment (`~/.config/zsh/env/infisical.zsh`). It never acts as the user. Anything it creates belongs to that identity alone: the user is not a member and every later action needs an invitation.
- **CLI** (`infisical login`): the user's own session. It reads and writes secrets, injects them with `infisical run`, and has no project or environment commands. `infisical user get token` returns its bearer token for the REST API.

## Rules

- **Never create a project or an environment through the MCP.** Use the REST API with the user's CLI session, per [projects.md](projects.md), with exactly the environments the project needs: a default creation adds `dev`, `staging`, `prod` whether wanted or not.
- Use the MCP for listing projects, checking secret names and writing values in projects where its identity is a member. Pass `INFISICAL_MASK_SECRET_VALUES=true` semantics: never request an operation that returns values just to check names.
- A `403 ProjectMembershipNotFound` on a project the user should own means the machine identity created it: invite the user as admin through the MCP (`invite-members-to-project`), then report why it happened.
- Secret values enter the vault through the dashboard or a shell variable read with `read -rs`, never through chat, command arguments, tool arguments, logs or temporary files. Verify a write by printing the key name or the first characters only.
- Keep API tokens in shell variables for the duration of a command, never in files.

## Reference

| Read when | File |
|---|---|
| Creating, renaming or deleting a project or an environment, or adding the user to a project | [projects.md](projects.md) |
