---
name: legacy-workspace-audit
description: "Use when auditing legacy AI folders before deletion."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [migration, legacy, audit, claude, workspace, cleanup, security]
    related_skills: [claude-to-hermes-migration, hermes-agent]
---

# Legacy AI Workspace Audit

Audit an abandoned AI-tool workspace before deciding what to migrate, archive,
redesign, or delete. This is a **triage skill**, not a blind copy/delete recipe.
It is useful for old Claude Desktop, ChatGPT Projects, Cowork, Cursor, or similar
folders containing project rules, artifacts, datasets, prompts, and scheduled
procedures.

## Core invariants

- Inventory first, then read, then compare against the current Hermes workspace.
- Never overwrite a current canonical file with a legacy copy.
- Never copy plaintext passwords, API keys, session tokens, cookies, or secrets
  into Hermes skills, prompts, reports, or project files.
- Report secret-bearing paths and counts, never secret values. Recommend rotation
  when a credential may still be valid.
- Treat old scheduled prompt files as source material. Rebuild them as Hermes
  cron jobs or skills only after checking their tools, side effects, and
  authentication model.
- Do not move or delete anything until the user has an explicit migration plan
  and the selected destination has been verified.
- For Walid's workspaces, project files belong under
  `~/Documents/Hermes/<project>/`, not directly under `~/Documents/`.

## Workflow

### 1. Establish scope and destination

Record the exact source path, whether it is local or iCloud-synced, and the
intended Hermes destination. If the user has a folder convention, follow it.
Do not create a desktop Project merely to make the audit look complete; create or
switch a Project only after the destination path and migration scope are settled.

### 2. Build a complete inventory

Walk the source recursively and capture:

- files, directories, and empty directories;
- symlinks and their targets;
- relative path, extension, byte size, and modification time;
- totals by top-level directory and file type;
- likely control files (`CLAUDE.md`, `AGENTS.md`, `SKILL.md`, README, journals,
  configuration files);
- binary workbooks and their sheet names/dimensions;
- HTML titles and whether they are standalone artifacts.

Use deterministic code for aggregation rather than estimating counts mentally.
Do not rely on a supplied tree excerpt when the live filesystem is available.

### 3. Read the high-value content

Read project rules, journals, playbooks, configuration, and representative
CSV headers/rows. For `.xlsx`, use `openpyxl` through `terminal()` when needed,
with `data_only=False` whenever the workbook may later be edited, so formulas
are preserved. `execute_code` may use a different Python environment, so a
missing package there is not proof that the host Python lacks it.

For large HTML artifacts, inspect titles, headings, scripts, and local/external
resource references rather than dumping the entire file into context.

### 4. Compare with Hermes before recommending import

Inspect the current destination and existing Hermes systems:

- current project files and source-of-truth documents;
- existing skills and README procedures;
- active cron jobs, their last status, and recent error output;
- current authentication/session mechanisms;
- existing archives or generated artifacts.

Use evidence appropriate to the data type:

- hashes for exact duplicate detection;
- line-prefix or section comparison for journals and append-only logs;
- sheet names, dimensions, formulas, and selected headers for workbooks;
- CSV headers, row counts, and deduplication keys for trackers.

A legacy journal that is an exact prefix of a longer current journal is
superseded, not a second source of truth. A legacy workbook with fewer sheets
than the current workbook should not replace the current one.

### 5. Scan for secrets before copying

Scan text files for credential indicators such as password assignments, API-key
fields, bearer tokens, cookies, private keys, and login URLs. Record only:

- file path;
- kind of credential;
- number of suspicious lines;
- whether rotation should be considered.

Never print, quote, hash for identification, or store the secret value. Do not
copy a file containing secrets as-is. Prefer Hermes Keychain/session mechanisms
and redact or rewrite the procedure.

### 6. Classify every block

Use four explicit decisions:

| Decision | Meaning |
|---|---|
| **Active import** | Valuable data/rules with a defined Hermes destination |
| **Redesign** | Valuable logic, but old tools, paths, credentials, or side effects require a native Hermes rebuild |
| **Archive** | Useful historical/reference artifact, not part of active operations |
| **Skip/delete** | Duplicate, empty, obsolete, generated noise, or unsafe without value |

Do not classify an entire top-level directory as one unit when its files have
different decisions.

### 7. Map concepts to Hermes

Common mappings:

| Legacy workspace | Hermes destination |
|---|---|
| `CLAUDE.md` project rules | `.hermes.md` or `AGENTS.md`, depending on portability needs |
| project data and trackers | `~/Documents/Hermes/<project>/` with a documented canonical file |
| scheduled prompt folder | Hermes cron job plus a reusable skill/reference |
| browser automation using vendor-specific MCP tools | Hermes `browser_exec`/approved browser workflow, isolated per agent |
| plaintext credentials | macOS Keychain/session storage, never a copied prompt |
| standalone HTML artifact | archive or project documentation, not an active skill |
| old financial workbook/journal | compare against the current finance source; never overwrite it |

Separate read-only discovery and drafting from external side effects such as
submitting applications, sending messages, changing profiles, or making
purchases. Rebuild side-effecting automation only with explicit scope,
platform-specific guards, deduplication, confirmation checks, and a safe stop
path for login walls, CAPTCHA, 2FA, unexpected forms, or legal/payment UI.

### 8. Produce the audit report

Return:

1. exact inventory totals;
2. a top-level and file-level decision matrix;
3. what is already present in Hermes and must not be re-imported;
4. security findings without exposing secrets;
5. a proposed destination tree;
6. the Hermes automations worth rebuilding;
7. a deletion sequence with verification gates;
8. an explicit statement of what was not modified.

Use concise tables and concrete paths. Do not claim a migration, import, or
successful cron repair unless the corresponding tool output verifies it.

## References

- See `references/triage-matrix.md` for the decision matrix, comparison checks,
  and validated audit observations.
- For the actual copy/create/switch phase, load the existing
  `claude-to-hermes-migration` skill as well; this skill deliberately stops at
  safe triage unless migration is explicitly requested.

## Common pitfalls

- Trusting an attached directory listing instead of walking the live path.
- Copying every `SKILL.md` into Hermes even when it contains old MCP names,
  absolute legacy paths, passwords, or unattended side effects.
- Treating a current workbook and its legacy snapshot as interchangeable.
- Calling a job "operational" because it is enabled; inspect `last_status` and
  logs too.
- Creating a cron for every old scheduled folder instead of consolidating the
  durable logic into a small number of read-only and action phases.
- Deleting the source before checking row counts, sheet structure, and the
  selected destination.
