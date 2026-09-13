# Bank ↔ Klarna/PayPal mapping register

Use this reference when an audit must connect immutable bank exports to intermediary histories without double-counting.

## Purpose

The register is a derived evidence layer. It answers:

- which raw bank row corresponds to an external payment;
- which provider/merchant and external operation are involved;
- whether the relationship is certain, probable, weak, or unresolved;
- which transaction is actually counted in the audit.

It must never replace the bank export, alter raw files, or add external-history totals to bank totals.

## Recommended record shape

Keep one stable record per relationship, with fields equivalent to:

```json
{
  "mapping_id": "provider:external-record:raw-row",
  "raw_source": "Revolut | Qonto",
  "raw_row_id": "stable source row identifier",
  "audit_transaction_id": "transaction-id used by the audit app",
  "raw_account": "account name",
  "raw_date": "YYYY-MM-DD",
  "raw_amount": -12.34,
  "raw_label": "original bank label",
  "evidence_provider": "Klarna | PayPal",
  "evidence_id": "external transaction or evidence identifier",
  "evidence_date": "YYYY-MM-DD or null",
  "evidence_amount": 12.34,
  "evidence_merchant": "merchant or explicitly unknown",
  "evidence_detail": "installment/type/plan detail",
  "relation_type": "bank_debit_for_installment | underlying_purchase | settlement | refund | wallet_funded | unresolved",
  "match_method": "amount/date/label/one-to-one explanation",
  "confidence": "certain | probable | low | unresolved",
  "status": "matched | to_review | unmatched | rejected",
  "counted_transaction_id": "raw bank transaction ID or null",
  "counted_amount": -12.34,
  "counted_once": true,
  "double_counting_rule": "bank debit only; evidence is not added"
}
```

A CSV export is useful for inspection; JSON is useful for the audit API and future agents. Preserve both only if they are generated from the same source and can be checked for consistency.

## Matching recipe

1. Read the journal and validate all raw input paths before processing. Inspect delimiters, encodings, headers, date formats, currency, sign convention, and transaction identity fields programmatically.
2. Parse completed EUR bank rows without normalizing away the original label or source row identity. Store signed bank amounts; use absolute values only for candidate comparison.
3. Normalize external evidence into typed records. For PayPal, retain payment, refund, wallet funding, withdrawal, reversal, transfer, and conversion types. For Klarna, retain merchant, installment number/total, plan total, payment source, grouped-payment status, and wallet-funded status when visible.
4. Generate candidates with an amount tolerance appropriate to the exports and a bounded date window. A common starting point is exact cents and ±3 calendar days, but the tolerance must be recorded in `match_method` and adjusted when the provider settles on a different date.
5. Enforce one-to-one use of raw bank rows for payment relationships. Do not let repeated same-amount rows all map to the same evidence row; resolve with date, labels, stable IDs, and remaining-candidate constraints.
6. Prefer `certain` only when amount/date/identity evidence is strong. Use `probable` when the relationship is plausible but not uniquely proven, `low` when collisions or weak labels remain, and `unresolved` when no defensible candidate exists.
7. Keep evidence-only rows that have no bank match in an explicit unmatched collection. Never silently drop them and never count them as bank expenses.
8. Attach mappings back to audit transactions by stable audit ID, not by array position or display label. This lets notes and future review search the external context while leaving raw data untouched.

## Provider-specific guardrails

### Klarna

An underlying purchase, an installment, and the bank debit are different levels of the same economic event. The bank debit is counted once. The Klarna row can provide merchant and plan context, but an installment with no bank debit (for example, wallet-funded) must remain explicitly non-bank or unresolved. Grouped payments without an individual date should not be force-matched to a particular debit.

### PayPal

The PayPal CSV may contain both payments and non-expense movements. Preserve the original operation type and sign. A generic bank label such as `PAYPAL`, `Pay Pal`, or `Paiement 4X` does not prove the underlying merchant. Use the merchant from the external record only when the evidence relationship itself is sufficiently strong; otherwise write `PayPal — fournisseur à identifier` and keep the confidence low/probable. Refunds, top-ups, withdrawals, and transfers must not be classified as ordinary purchases.

## Verification checklist

Before reporting the register as complete:

- every mapping has a stable `mapping_id`;
- raw row IDs are unique unless a documented one-to-many relation is genuinely required;
- external IDs are preserved exactly when available;
- dates, signs, and amounts can be traced back to the original files;
- the counted transaction is explicit, and external evidence is marked not counted;
- low-confidence, grouped, wallet-funded, and unmatched records remain visible;
- bank item count and cent total are unchanged after mapping;
- API/UI exposure is checked by reading back the mapping endpoint and at least one attached transaction;
- JSON/CSV generated views agree on mapping count and IDs;
- official workbook and raw exports have not been modified.

If the register is regenerated, verify the output rather than trusting the process exit code alone: compare summary counts, duplicate IDs, unmatched counts, and the bank-total invariant.
