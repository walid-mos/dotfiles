---
name: personal-finance-tracking
description: Use when updating Walid's finances, debts, or snowball plan.
---

# Personal Finance Tracking (Walid)

The user's finances live in an iCloud folder so they sync to all his
devices and stay readable by the agent (openpyxl, no Excel needed).

## Location

`~/Library/Mobile Documents/com~apple~CloudDocs/Documents/Finances Hermes/`

- `finances.xlsx` — 7 sheets: Synthèse, Plan d'attaque (snowball),
  Dettes perso, Dettes Nextnode, Prévisionnel Nextnode, Suivi Nextnode,
  Budget perso. Synthèse cells are formulas referencing other sheets.
- `journal-decisions.md` — chronological decision log with amounts.
  **Read it before any modification**; it explains every rule below.

## Standing rules (never violate without explicit user instruction)

- Strict pro/perso separation: each sheet only carries its account's
  flows; the only bridge is "Rémunération versée à Walid".
- Provisions on every pro encaissement: TVA 20% + URSSAF 30% of HT into
  Qonto sub-accounts; IR provision 18% of rémunération on the perso side.
- Never reason in interest rates — only fixed majorations and urgency
  levels (huissier, saisie, expulsion).
- Snowball order: urgencies first, then smallest-to-largest.
- No new family loans except rent emergencies.

## Workflow for updates

1. Read `journal-decisions.md` tail + Synthèse sheet for current state
   (dettes totals, next actions).
2. Ask what changed since the last dated entry: encaissements, payments
   made, new loans, rent paid.
3. Update the relevant sheets (keep formula cells intact — load with
   openpyxl normally, never `data_only=True` then save, which would
   destroy formulas).
4. Append a new dated entry to `journal-decisions.md` in the existing
   format (Fait / Impact registre / Règle rappelée), including old→new
   totals.
5. Report old → new dette totals (perso / pro / total) back to the user.

## Pitfalls

- The xlsx uses French number formatting inside strings ("4 620 €");
  when editing, keep the same style.
- Cached formula values only exist if a real spreadsheet app saved the
  file last; after openpyxl edits, values show stale until recalc.
- Migrated from the user's abandoned Claude setup (Claude uninstalled);
  prospection CSVs and Scheduled SKILL.md files there were deliberately
  not imported — do not re-import them unprompted.

## See also

- `productivity/xlsx` skill for workbook editing mechanics.
