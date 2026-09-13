# Raw interactive expense audit recipe

This reference records the proven workflow for auditing raw Revolut/Qonto exports without creating a second source of financial truth.

## 1. Source and window

- Read `journal-decisions.md` before any financial-file change.
- Use the original CSV exports as the amount/date/sign source. Keep raw descriptions alongside normalized labels.
- Parse the actual delimiter and encoding: Revolut exports commonly use comma-separated UTF-8; Qonto exports commonly use semicolon-separated UTF-8 with French decimal commas.
- Filter to EUR rows with the provider's completed/executed status and negative personal amounts or positive Qonto debit amounts.
- For budgeting, use 12 complete calendar months and show the current partial month separately. Use older history only for recurrence and anomaly checks.

## 2. Reconciliation gates

Before reporting:

```text
raw_valid_debit_count == derived_item_count
round(raw_valid_debit_total, 2) == round(derived_total, 2)
transaction_ids_are_unique
sum(flow_bucket_totals) == derived_total
```

A failed gate means the result is not ready for budgeting.

## 3. Classification axes

Store these independently:

- `account_scope`: Revolut/personal or Qonto/professional;
- `economic_scope`: Perso, Pro, Flux interne, or À définir;
- `macro` / `subcategory`: the nature of spending;
- `flow_type`: expense, debt_or_arrears, tax/social obligation, internal_transfer, family_transfer, cash_withdrawal, or pro_paid_personally;
- `confidence`, `needs_review`, and a human context note.

This prevents professional Claude/AI/Orange/AppleCare charges paid from Revolut from becoming personal consumption and keeps internal transfers, debt, taxes, and arrears out of ordinary recurring budgets.

## 4. Review UI

A local server can read the raw CSVs live and expose a derived JSON view. The browser should support:

- Perso / Pro / Tout scopes;
- À revoir / Toutes les dépenses modes;
- transaction-level and grouped-by-label views;
- drag-and-drop into hierarchical budget subcategories;
- a note field per transaction/group;
- note autosave after about one second of inactivity, plus save on blur, Enter, or button;
- polling around every 20 seconds, but skip re-render while a note field is focused;
- no modification of the official workbook from the UI.

Store only transaction-id keyed decisions and notes. Notes alone should not close a review item or silently change its category; they are evidence for the next manual/assisted pass.

## 5. Family and spouse transfers

Counterparty names are not enough to label a transfer as a donation or debt. For a spouse such as Yasmine:

- use a neutral category like `Transferts familiaux — prêt / remboursement / don à qualifier`;
- keep the outgoing transfer visible as a cash-flow event, not an ordinary expense;
- show nearby incoming transfers (for example within ±7 days) as context;
- never automatically match, net, or compensate incoming and outgoing flows;
- let a user note such as `remboursement du 22-08` support a specific transaction-level decision.

## 6. Monitoring semantics

The local app can persist comments and poll the derived view. The chat agent is not a push subscriber: it must reread the decisions file or API when a later audit/reclassification is requested. Be explicit about this boundary instead of claiming that the assistant is continuously watching the user's screen.

## 7. Proven verification probes

- Run a one-shot server snapshot and compare its count/total to an independent raw parser.
- Test the note endpoint with a temporary annotation, verify it round-trips through `/api/data`, verify that note-only annotations leave `needs_review` true, and remove only the temporary test annotation.
- Compile the server and parse/check the page JavaScript before delivery.
- Preserve genuine user annotations; do not delete an existing decision file merely because a test was run.

## 8. Closing a full audit pass (proven end-to-end, 25–26/08/2026)

The queue went 684 rows / 22 688 € → 0 rows in one working session. Sequence that worked:

1. Automatic pass: apply rules + evidence mappings first; report before/after counts and totals at every step so progress is visible.
2. Present remaining unknowns as compact grouped tables (label → count → total → dates) for batch user decisions; never row-by-row interrogation when a whole label shares one explanation.
3. When the user answers in bulk (a pasted table of date/account/label/amount plus per-group explanations), classify the entire batch in ONE code pass keyed on (date, account, amount) — never one tool call per row.
4. For opaque labels, search French business registries BEFORE asking; only truly unresolvable ones go to the user.
5. Offer a dynamic selection page (`/review`) once groupings stop fitting; let him pick batches himself and paste/CSV them back.
6. After each pass: re-run the reconciliation gates, refresh any embedded-data review page, update `review_pass_*.json` (append an `update_<date>` section rather than overwriting), and append a journal entry summarizing what moved and which rules are now standing.
7. Final state to verify before declaring done: review queue count == 0, raw count/total unchanged vs. session start, official workbook hash identical.

Tone guardrail from this session: when stale data resurfaces after the user already gave a standing rule (e.g. Yasmine transfers reappearing in review), fix the rule application immediately, acknowledge plainly without over-apologizing, and make sure the rule is recorded durably (decision notes + skill) so it cannot regress.
