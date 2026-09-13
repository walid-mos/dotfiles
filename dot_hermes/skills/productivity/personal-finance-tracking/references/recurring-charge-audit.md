# Recurring-charge audit from local exports

Use this reference when auditing recurring charges from Revolut/Qonto or similar local exports.

## Evidence-first sequence

1. Search the local finance folder for CSV/XLSX exports and read `journal-decisions.md` before using browser or desktop control. If exports exist, they are the primary evidence.
2. Parse the CSVs programmatically. Confirm row counts, date ranges, currency, completed/executed status, and the sign convention before computing totals.
3. Normalize merchant labels while retaining raw examples. Reconcile obvious variants such as `Free`/`Free Telecom`, `Orange SA`/`Orange SA-Orange`, and Apple labels. Keep distinct products such as ordinary `Pathé` purchases versus `Pathé CinePass`.
4. Group by merchant and calendar month. A recurring candidate needs month-by-month support; mark weak evidence as probable or to verify rather than calling it a subscription.

## Classification checklist

- **Fixed contractual:** rent, mobile, Qonto plan, leasing, confirmed subscriptions.
- **Variable recurring/utility:** energy, insurance, hosting, usage-based services, FX fees.
- **Instalment/arrears:** Klarna, PayPal, rattrapages, debt repayments, overdue accounting, leasing arrears. These create monthly pressure but are not normal subscriptions.
- **Variable consumption:** groceries, fuel, restaurants, Amazon, ordinary purchases.
- **Inactive/ended:** repeated historical charges with no recent occurrence; report the last date and request confirmation rather than assuming cancellation.
- **One-off/debt/internal:** seizures, tax payments, family transfers, pocket movements, account-to-account transfers, and debt settlements. Exclude from the recurring baseline but report separately when cash-flow relevant.

## Output contract

For each item report: raw label examples; date span and number of active months; normal/base amount; exceptional amounts and suspected arrears/retries; latest observed date; account scope (personal/professional); classification; and suggested action (keep, verify, negotiate, or suppress). Give separate personal and professional baselines. Never double-count a service merely because it moved between accounts.

Use the journal/workbook for obligations absent from the normal transaction pattern (rent due, planned future instalments, expected accounting fees), explicitly labelling those as contextual evidence. Do not modify `finances.xlsx` during an audit unless asked.

## Session-derived examples

- A label appearing monthly is not enough: Qonto's own `Qonto` rows combine the 27.60 EUR plan, tiny FX fees, and exceptional seizure/SATD fees.
- `Free` and `Free Telecom` should be cross-checked as one provider, but the base payment and higher catch-up months should remain visible.
- `Claude` appearing first on Qonto and later on Revolut must be checked for account migration/duplication before summing.
- PayPal/Klarna totals can dominate a month while still being temporary instalments; show them as a separate pressure line.
