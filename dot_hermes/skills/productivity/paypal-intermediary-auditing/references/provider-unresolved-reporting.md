# Reporting unresolved provider identities

Use this reference when the user asks for PayPal payments whose final provider/merchant is still unknown.

## Deterministic procedure

1. Parse every supplied PayPal CSV with an explicit encoding and delimiter; preserve the source file and raw transaction ID.
2. Deduplicate exact `Numéro de transaction` values across files before counting anything.
3. Select canonical outgoing purchase events only. Typical inclusions are completed `Paiement standard`, `Paiement Express Checkout`, completed pre-approved invoice payments, buyer-credit payments, BillPay payments, and mobile payments when they are outgoing. Exclude authorizations/memos, refunds, cancellations, reversals, deposits, withdrawals, conversions, transfers, and wallet movements.
4. Follow `Numéro de la transaction de référence` to attach authorization/provenance records to the canonical payment. Do not create a second payment for the authorization or reference event.
5. Mark the provider unresolved when `Nom` is `PayPal Inc.`, another generic PayPal label, or blank and no independently linked PayPal record supplies a named beneficiary/provider. An invoice number, product title, email fragment, or amount/date coincidence is not enough by itself.
6. Independently determine whether the canonical payment is linked to a bank debit. This status must not change `merchant_status`.
7. Report both dimensions:
   - total unresolved-provider count and amount;
   - unresolved-provider payments with a bank match;
   - unresolved-provider payments without a bank match.

## Recommended output columns

| Date | Amount | PayPal transaction ID | Reference ID | Exported name | Bank match |
|---|---:|---|---|---|:---:|

Use a short legend such as `B = bank debit matched` and `N = not bank matched`. Keep the transaction ID and reference ID literal; never normalize or truncate them.

## Safety and wording

- Say “provider final non prouvé” or “merchant final unresolved,” not “PayPal fee,” unless the fee field and operation type establish a fee.
- Say explicitly when a bank debit is matched but the provider remains unknown.
- Never substitute a provider found in another PayPal row or a nearby bank transaction.
- Do not add PayPal evidence to bank expense totals; the bank debit remains the only counted expense.
- Do not modify raw exports or the official workbook while producing the report unless the user separately authorizes a derived-layer update.
- Before finalizing, verify the enumerated row count and amount with code, not mental arithmetic, and ensure the list count agrees with the declared total.
