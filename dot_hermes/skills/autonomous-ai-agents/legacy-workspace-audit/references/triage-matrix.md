# Legacy workspace audit triage matrix

Use this matrix after the filesystem inventory and current-Hermes comparison.
It keeps a large legacy folder from being treated as one indivisible import.

## Decision matrix

| Evidence | Decision | Typical Hermes action |
|---|---|---|
| Current rules, data, or trackers with no active Hermes equivalent | Active import | Copy into `~/Documents/Hermes/<project>/`, then verify counts and paths |
| Useful logic tied to old MCP tools, old absolute paths, plaintext credentials, or unattended side effects | Redesign | Rewrite as a Hermes skill/cron with Keychain, isolated sessions, deduplication, and safe stops |
| Standalone HTML, old research, dated plans, or a superseded snapshot | Archive | Store outside the active project, clearly labeled with origin/date |
| `.DS_Store`, empty directories, duplicate logs, obsolete wrappers, or generated noise | Skip/delete | Remove only after the selected destination is verified |

## Comparison checks

- **Append-only journal:** compare whether the legacy text is an exact prefix of
the current journal. If yes, the current journal supersedes it.
- **Workbook:** compare sheet names, dimensions, formulas, and source-of-truth
status. A larger current workbook must not be overwritten by a smaller legacy copy.
- **CSV tracker:** preserve the legacy file as history unless a canonical CRM
has been chosen. Check headers, row counts, URL/title deduplication keys, and
whether the destination already contains the same records.
- **Project rules:** convert `CLAUDE.md` into `.hermes.md` when the rules are
intended to load automatically in the Hermes project subtree. Remove old tool
names and absolute source paths during the rewrite.
- **Scheduled prompts:** inspect authentication, side effects, cadence, and
failure behavior before creating a cron. Consolidate related prompts instead of
creating one job per old directory.

## Security reporting

When a scan finds credential-like lines, report only the file paths, credential
category, and count. Never put values in the audit, a support file, a cron
prompt, or Hermes memory. Do not copy the file as-is. If the service may still
be active, recommend credential rotation before the legacy source is deleted.

## Validated observations from a macOS migration audit

- An old Claude folder may contain valuable project history even when it has no
source code or Claude export. File counts and modification dates are enough to
separate active project material from one-off artifacts only after reading the
control files.
- An existing Hermes project can already contain a newer financial workbook,
longer journal, and additional archive sheets. Treat the active workbook as the
canonical source and do not import the older copy.
- A current Hermes cron can be enabled yet still unusable. Inspect both
`last_status` and recent scheduler/error output before reusing its architecture
or adding dependent jobs.
- A legacy refresh prompt may be redundant when Hermes already has a broader
presence agent using Keychain and an isolated browser session. Prefer one
maintained agent over parallel copies.
- Browser jobboards and profile-refresh tasks should be split into read-only
research/drafting and explicit external actions. This makes later approval,
rollback, and platform-specific safety guards possible.

## Report format

End the audit with:

1. inventory totals;
2. a decision table by directory and important file;
3. current-Hermes duplicates/superseded sources;
4. secret-bearing paths without values;
5. proposed destination tree;
6. redesign candidates for cron/skills;
7. verification gates before deletion;
8. a statement of files left untouched.
