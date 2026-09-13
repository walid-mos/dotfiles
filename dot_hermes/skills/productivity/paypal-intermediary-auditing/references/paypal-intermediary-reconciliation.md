# PayPal intermediary reconciliation reference

## Header checklist

For each supplied CSV, inspect and preserve:

- `Date`, `Heure`, `État`, `Devise`, `Type`;
- `Nom`, sender/recipient email, seller nickname;
- `Avant commission`/gross, `Commission`, `Net`;
- `Numéro de transaction`;
- `Numéro de la transaction de référence`;
- `Numéro de facture`, object/item/order number;
- `Objet`, `Détails de l'objet`;
- `Source de paiement`, `Impact sur le solde`.

The exact French headers vary slightly between PayPal exports. Never assume a missing column means missing evidence until the full header is inspected.

## Canonical transaction selection

Deduplicate by transaction ID across all files. For each logical chain:

- retain a completed outgoing payment, express-checkout payment, or pre-approved payment as the candidate purchase evidence;
- retain authorizations/memos as linked provenance, not additional purchases;
- retain refunds, cancellations, reversals, deposits, withdrawals, conversions, and wallet movements as separate non-purchase events;
- follow reference IDs both forward and backward when the export contains the linked row;
- preserve all source file names and IDs in the evidence record.

A generic `PayPal Inc.` row can remain the canonical payment evidence even when the merchant is unresolved. Set `merchant_status=intermediary_only`; do not replace it with a named merchant from another unrelated payment.

## Safe bank matching

```text
if merchant_status == intermediary_only:
    accept only if the bank label explicitly contains PayPal or Paiement 4X
else:
    accept only if merchant tokens overlap the bank label
    or the bank label explicitly contains PayPal
require amount equality to cents and a narrow date tolerance
apply one-to-one bank/evidence assignment
if several candidates remain: lower confidence or leave unresolved
```

Amount/date coincidence alone is not merchant evidence. A generic PayPal row must not be attached to an unrelated named bank merchant. The bank debit is the only counted amount.

## What `PayPal Inc.` means

In generic account exports, `Nom = PayPal Inc.` with `Type = Paiement standard` may identify PayPal's intermediary record, not the final seller. `Commission/Frais = 0,00` does not prove a fee; it only reports no commission on that PayPal row. The final merchant is proven only by a named PayPal record, an item/order/invoice field, a recipient identity, or another independently linked detail record.

## OAuth/MCP verification

A browser page saying OAuth authorization succeeded proves that the user completed the browser step, not that the MCP data endpoint is reachable. Verify with `hermes mcp test <server>` or a read-only provider call before claiming account access. If the live test is not successful, continue with detailed CSV evidence and state that direct account access is unverified. Never request or store passwords, API keys, or 2FA codes.
