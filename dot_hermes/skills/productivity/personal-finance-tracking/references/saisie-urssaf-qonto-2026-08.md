# Session learnings — URSSAF huissier / saisie Qonto (24/08/2026)

## What happened
- Saisie-attribution served on Qonto by the huissier for a "sold" URSSAF 2024
  dossier: 665,14 € isolated + 100 € Qonto processing fee. Encaissements after
  the act is processed are not seized.
- Root cause of the registry error: a 1 673,12 € payment logged as settling the
  huissier dossier actually settled a different early-year cotisation debt.
  Payment attribution across URSSAF periods is easy to get wrong — always ask
  the huissier for a written décompte before marking anything SOLDÉE.

## Registry correction pattern (reusable)
1. Correct the earlier journal entry (note the error in the new dated entry,
   never silently rewrite history).
2. Reactivate the existing creditor row in `Dettes Nextnode` (rename + new
   capital) instead of adding a duplicate row.
3. Update Synthèse date header and rewrite "Prochaines actions" with the
   urgent item first.
4. Report old→new totals.

## openpyxl gotchas hit
- `Synthèse` sheet has many merged ranges (B15:J15, B16:J16, …): only the
  top-left anchor cell is writable; others raise `MergedCell is read-only`.
- execute_code sandbox lacks openpyxl; run edits via terminal() heredoc python.
- Formula cells (`=SUM(...)`, cross-sheet refs) survive normal openpyxl loads;
  never `data_only=True`.

## Standing rule reaffirmed
Qonto TVA/URSSAF sub-accounts are untouchable — when any saisie lands, first
check which account the isolated sums came from.
