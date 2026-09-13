# Human-assisted spending review

## Context notes

A raw-export audit should expose a free-text note on every transaction or review group. Save the note by stable transaction ID, keep it searchable and display it after reload. A note alone is evidence/context, not a validated classification: `needs_review` remains true until the user explicitly chooses a category.

If the review UI refreshes periodically (for example every 20 seconds), skip the refresh while a note input is focused so the user's draft cannot be lost. Grouped-by-label notes may be applied to all transaction IDs in the group, but mixed merchants must retain a transaction-level fallback.

## Spouse and family transfers

Transfers with a spouse or family member are neutral until qualified. They can be a loan, repayment, shared expense, support, gift or couple transfer. Never infer donation or debt from direction, recipient, or a nearby opposite-direction payment. Show nearby incoming/outgoing transactions as context, but do not auto-match, net, deduct, or close review. Keep incoming flows out of expense totals unless the user explicitly requests an income/loan-flow reconciliation.

## Validation contract

- Preserve raw amount/date/label and stable transaction ID.
- Store only transaction-ID → note/classification in the derived review layer.
- Reconcile raw debit count and sum after any UI change.
- Do not write provisional classifications into the official workbook.
