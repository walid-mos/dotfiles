# Raw export review recipe

## Scope and source boundaries

Use the original Revolut and Qonto CSVs as the transaction-level evidence. Keep `finances.xlsx` as the official source for live balances, debt totals and approved budgets. The interactive audit layer must not copy amounts into a second ledger; it may store only stable transaction-ID → classification/note decisions.

For a budgeting baseline, declare 12 complete calendar months and show the current partial month separately. Older history may be used to identify recurring merchants, but must not silently enter the main baseline.

## Parsing and reconciliation

1. Inspect each CSV's delimiter, date format, currency, status values and sign convention before calculating.
2. Keep raw label, normalized label, date, amount, account and stable transaction identifier together.
3. Filter completed/executed EUR debits for the expense view. Keep credits available for contextual transfer reconciliation, not as negative expenses.
4. Before reporting totals, independently verify:
   - raw debit count == audit item count;
   - raw debit sum == audit total;
   - transaction IDs are unique;
   - flow subtotals sum to the global total.

## Classification axes

Store these independently:

- payment account: Revolut or Qonto;
- economic owner: personal, professional, internal flow or undetermined;
- nature: macro-category + subcategory;
- cash-flow status: ordinary expense, debt/arrears, internal transfer, cash withdrawal, professional-paid-personally or family transfer;
- confidence and review reason.

Unknown or mixed labels remain in the review queue. Missing labels are not evidence of a missed payment, cancellation, donation or debt.

## Interactive review behavior

The local review UI should provide Perso/Pro/All scope, review-only/all modes, search, flow filters, transaction-level drag-and-drop, and grouped-by-label drag-and-drop with a transaction-level fallback for mixed merchants.

Each transaction should have a free-text context note:

- save note by stable transaction ID;
- make it searchable and visible after reload;
- a note-only save does not set `needs_review=false`;
- if the UI polls (20 seconds is reasonable), skip refresh while a note input is focused;
- grouped notes may be applied to all IDs in the group, but the raw IDs remain distinct.

## Spouse and family transfers

Do not automatically classify transfers to a spouse or family member as a donation, loan, repayment or ordinary expense. They may represent a loan, repayment, shared expense, support, gift or couple transfer.

For a spouse such as Yasmine, use a neutral class such as `Transferts familiaux → prêt / remboursement / don à qualifier`, keep the transaction in review, and show nearby opposite-direction entries as context (same day or a small date window). Do not auto-match, net, deduct, or close the review. Incoming transfers stay outside expense totals unless the user explicitly requests an income/loan-flow reconciliation.

## Finalization

Only after the user validates material review items should official budget lines be updated. Preserve workbook formulas, recalculate through a real spreadsheet application when needed, and add a dated journal decision for the approved change. Never present provisional audit classifications as live debt or budget balances.
