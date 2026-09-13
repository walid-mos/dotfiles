# PayPal intermediary reconciliation

Use this reference when a bank export shows `PAYPAL`, `Pay Pal`, `Paiement 4X`, or when a PayPal export reports `Nom = PayPal Inc.`.

## Evidence hierarchy

1. **Bank export** is authoritative for the counted movement: date, sign, amount, account, and raw label.
2. **PayPal export** identifies the intermediary operation and may identify the final merchant.
3. **Detailed PayPal activity or individual payment detail** is required when the generic PayPal export does not expose the seller.

Never add the PayPal row to the bank expense total. The bank debit is the only counted expense.

## Minimum PayPal fields to preserve

Keep the raw values, not only a normalized merchant:

- date and operation description/type;
- gross, fees, and net;
- PayPal transaction ID;
- reference transaction ID;
- invoice/order ID when present;
- exported name/payee;
- currency and status;
- payment source or related transaction when available.

## `PayPal Inc.` rule

`Nom = PayPal Inc.` is an intermediary label, not proof of the final seller. If the row has `Frais = 0`, it is not evidence of a PayPal fee. Keep it as `merchant_status: intermediary_only` and leave the final merchant unresolved unless another PayPal record names the seller.

Do not convert a generic row into a definitive category from the amount, date, recurring amount, or a guessed service. Repeated amounts can represent installments, subscriptions, or unrelated transactions.

## Matching guardrails

- Match one evidence row to at most one bank row.
- Generic intermediary evidence may match only a bank label that explicitly identifies the intermediary (`Pay Pal`, `PAYPAL`, or `Paiement 4X`), subject to amount/date tolerance and one-to-one use.
- Do not match generic `PayPal Inc.` evidence to `Ikea`, `Intermarché`, a named person, or another merchant solely on amount/date coincidence.
- For a named PayPal merchant, require merchant-label overlap or an explicit bank-side PayPal label; amount/date alone is insufficient.
- Preserve unmatched and low-confidence records instead of forcing them into the review result.
- A bank row can remain in `À revoir` even when its PayPal intermediary payment is successfully mapped: the mapping proves settlement through PayPal, not the economic nature of the purchase.

## What to request from the user

If the generic export lacks the merchant, request an activity-detail export or individual transaction details containing seller/payee, item or order, invoice/reference, transaction ID, date, gross, fee, and net. The user may redact email addresses, postal addresses, bank details, and unrelated personal data, but must retain the transaction identifiers, dates, amounts, and seller fields.

## Live account verification (authenticated browser)

The strongest merchant evidence is the user's live PayPal session. Proven workflow (25/08/2026):

- After the user logs in manually (never ask for credentials/2FA), verify effective access by reading the rendered page — a redirect to the public `/fr/home` or login page is NOT access.
- The dedicated **Paiement en 4X** page (`paypal.com/myaccount/ppcredit/plans`) lists active AND historical plans with merchant name, purchase date, total, paid count (1/4…4/4), installment amounts, completion date, payment instrument. This inventory has priority over cadence-based grouping hypotheses: if a generic-row series has no matching named live plan, it stays unresolved even when totals coincide to the cent (a real case: a 4×15,25 € series summing exactly to a Vetostore plan total but with non-matching dates was correctly left unattributed).
- Open individual plan detail pages: they expose the full event log — automatic payments, **merchant refunds marked "Montant restant réduit"** (which shrink later installments), and adjusted plan totals. A refund can make later installments smaller than earlier ones.
- Bank debits lag PayPal dates by ~1 day; match on exact amount + date ±1–2 days with one-to-one use.
- Record the live-verification date and URL in evidence notes (`merchant_source: ... + PayPal live 4X detail JJ/MM/YYYY`).
- Even after exhaustive live inventory, some bank `Pay Pal` rows may have no matching plan at all — they stay in review until the user names them (in this dossier, two such rows turned out to be AliExpress purchases confirmed verbally).

## Verification checklist

Before reporting a PayPal mapping pass:

- count PayPal source rows by operation type and `Nom`;
- check the fee column independently from the merchant column;
- count generic rows marked `intermediary_only`;
- list generic matches whose bank label is not explicitly PayPal — expected count is zero;
- inspect named-merchant matches for label overlap;
- verify unmatched evidence remains visible;
- verify unique bank transaction IDs and unchanged bank count/total;
- verify no official workbook or raw export was modified.
