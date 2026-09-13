# PayPal 4X installment reconciliation

## Trigger

Use this reference when a PayPal account screen shows a merchant with `4 sur 4 payé(s)` or an active `1/4`, `2/4`, or `3/4` plan, especially when the detailed CSV contains nearby rows with `Nom = PayPal Inc.`.

These screens are PayPal's own **Paiement en 4X sans frais** interface, not Klarna. Treat the screenshot as a merchant/plan evidence layer; it does not replace the bank export or the raw PayPal CSV.

## Correct interpretation

A 4X purchase can produce two related representations:

1. a merchant-facing PayPal settlement or completed payment whose exported name identifies the real merchant and whose amount is the full purchase;
2. one or more financing/installment rows whose exported name is generic `PayPal Inc.` and whose amounts are the installments.

Therefore, `PayPal Inc.` is not automatically an unknown merchant. It may be the financing leg of a plan whose merchant is visible in the PayPal 4X screen or in the related full settlement.

## Deterministic workflow

1. Transcribe the screenshot exactly: merchant label, total amount for completed plans, installment amount for active plans, paid count, next/last date, and visible currency.
2. Parse all detailed PayPal exports with explicit encoding and delimiter detection; deduplicate by transaction ID across files.
3. Separate completed outgoing installment rows from authorizations, memos, refunds, reversals, deposits, withdrawals, conversions, and transfers.
4. Locate a named merchant settlement or completed payment with the same plan total, then locate generic completed rows whose installment amounts sum to that total to the cent (allow only documented currency-rounding differences).
5. Check chronological consistency with the screenshot (`4/4` completion date or active-plan next date) and preserve reference transaction IDs in the evidence chain.
6. Apply a one-to-one plan constraint: an installment row cannot be assigned to two plans, and a named merchant payment cannot be used to identify unrelated generic rows merely because the amount is similar.
7. Keep two independent statuses: `merchant_status` (provider identity) and `bank_match_status` (whether a bank debit was linked). A provider can be identified while the bank debit remains unmatched, or vice versa.

## Confidence levels

- **Strong**: screenshot merchant + named full settlement + complete installment sequence + exact total and coherent dates.
- **Probable**: screenshot merchant and exact installment/date evidence exist, but the sequence is incomplete, cents differ by rounding, or the named settlement has a different currency/amount.
- **Unresolved**: only a generic row and an amount/date coincidence exist; do not infer a provider.

Do not write strong/probable screenshot matches into the definitive mapping layer until the evidence record retains the screenshot provenance and the PayPal transaction IDs used for each installment.

## Anti-double-counting rule

The merchant settlement, the PayPal 4X installment rows, and the bank debit may describe one economic purchase. Count only the bank debit in official expense totals. Keep the merchant settlement and installment rows as evidence/provenance, not additional expenses.

## Common pitfalls

- Do not call a PayPal 4X screen Klarna based only on its installment layout.
- Do not classify every `Nom = PayPal Inc.` row as an unknown provider before testing for a 4X plan.
- Do not use a product title, invoice number, or nearby named payment as provider proof without a plan/transaction link.
- Do not add screenshot totals to bank totals.
- Do not overwrite raw PayPal exports or `finances.xlsx` while testing hypotheses; keep provisional matches in the derived audit layer.
