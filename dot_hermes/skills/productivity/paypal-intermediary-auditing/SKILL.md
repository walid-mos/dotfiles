---
name: paypal-intermediary-auditing
description: "Use for PayPal intermediary reconciliation audits and bulk review-queue deduction passes."
version: 1.4.0
author: Hermes Agent
license: MIT
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [finance, paypal, reconciliation, csv, intermediary, audit, double-counting]
    category: productivity
---

# PayPal intermediary auditing

Use this skill when a bank export contains `PAYPAL`, `Pay Pal`, `PAYPAL *Paiement 4X`, or another generic PayPal label and the final beneficiary is not obvious. The goal is to identify the real merchant only when evidence supports it, while keeping the bank debit as the only counted expense.

## When to Use

- A bank statement says PayPal but the real merchant is unknown.
- A PayPal CSV exports `Nom = PayPal Inc.` or blank merchant names.
- Several PayPal CSVs contain authorizations, completed payments, refunds, or reference chains.
- A user supplies detailed PayPal exports or asks to verify a PayPal MCP/OAuth connection.

## Non-negotiable source model

- Bank exports remain the source of truth for date, amount, sign, account, raw label, and the official expense total.
- PayPal exports, invoices, and account activity are evidence layers. Never add PayPal rows to bank expenses and never replace a bank amount with a PayPal amount.
- Keep classifications and mappings in a derived layer keyed by stable transaction IDs. Do not modify raw exports or the official workbook during evidence resolution.
- A PayPal intermediary match is not a merchant identification. Keep `merchant_status` separate from `relation_type` and `confidence`.

## PayPal export inspection

Inspect the complete header before interpreting `PayPal Inc.`. Useful fields include:

- date, state, type, currency;
- gross/before commission, commission/fees, net;
- sender and recipient email;
- transaction ID and reference transaction ID;
- invoice number, item/order number, object/title, item details;
- payment source, balance impact, shipping/insurance/tax fields.

Treat an exported `Nom = PayPal Inc.` as `intermediary_only` unless another PayPal record explicitly identifies the final merchant. A row with `Commission/Frais = 0` is not evidence that the operation is a PayPal fee. Generic `Paiement standard` is a payment type, not a merchant name.

## Detailed exports and payment lifecycle

Detailed PayPal exports are often split by date range and include multiple technical rows for one economic payment:

1. authorization or memo;
2. completed payment;
3. pre-approved or express-checkout settlement;
4. refund, cancellation, reversal, deposit, withdrawal, or conversion.

Deduplicate by transaction ID, then follow reference IDs to build a logical chain. Prefer the completed outgoing payment for the evidence record; retain authorization and reference IDs as provenance. Never count authorization + completed payment + bank debit as three expenses. Refunds and wallet movements must remain separate from ordinary purchases.

When several detailed CSVs are supplied:

1. detect encoding and delimiter programmatically;
2. record each file's date range and status/type distribution;
3. deduplicate by PayPal transaction ID across files;
4. preserve the file name and raw transaction ID for every evidence row;
5. resolve the logical payment chain before matching to a bank debit.

See `references/paypal-intermediary-reconciliation.md` for the field checklist, lifecycle filters, and matching guardrails. For the reporting pattern that separates unresolved provider identity from bank reconciliation, see `references/provider-unresolved-reporting.md`.

## Cross-file reference-graph resolution

When multiple PayPal exports cover overlapping periods, do not rely only on the reference ID stored on the generic row. Build indexes in both directions:

- transaction ID → all raw rows;
- reference transaction ID → all rows that point to it.

Then follow the chain through authorizations, completed merchant settlements, buyer-credit funding, refunds, and currency conversions. A generic row may point to an authorization whose corresponding completed settlement names the merchant; conversely, a buyer-credit row may point directly to a named settlement. Preserve the entire chain, but keep one canonical economic purchase.

Use operation type and balance impact as lifecycle filters. Rows such as `Autre` with code `T9900` and `Impact sur le solde = Mémo` are technical/memo events, not canonical purchases. Do not include them in unresolved-product counts merely because they have a negative net amount.

When exports overlap, deduplicate by literal transaction ID before counting. Reconcile the canonical count against the union of all supplied detailed exports, not against one historical export selected by convenience.

## PayPal 4X installment-plan detection

When a PayPal account screen shows `4 sur 4 payé(s)` or an active `1/4`, `2/4`, or `3/4` plan, do not classify every matching `PayPal Inc.` row as an unresolved provider. PayPal 4X can export the named merchant settlement separately from generic installment rows. Treat the screen as evidence of the merchant/plan, not as a replacement for the bank or raw PayPal sources.

Workflow:

1. Transcribe the screenshot's merchant, total or installment amount, paid count, next/last date, and currency.
2. Treat a screenshot explicitly labelled `Paiement en 4X sans frais` as PayPal evidence, not Klarna. Record whether the plan is complete, partially paid, or active; a missing fourth installment may simply be future, not absent from the export.
3. Deduplicate detailed PayPal exports by transaction ID and retain completed outgoing installments separately from authorizations, refunds, reversals, deposits, withdrawals, conversions, and transfers.
4. Find a named full settlement and a complete installment sequence whose sum matches the plan total to cents; verify dates against the screenshot. Search both direct reference chains and exact monthly installment sequences.
5. Preserve screenshot provenance and every installment transaction ID in the derived evidence layer.
6. Keep `merchant_status`, `bank_match_status`, and `economic_owner` independent. A merchant may be identified while its bank debit remains unmatched; a third-party use of the user's PayPal account must not be assigned to the user's personal or professional spending without evidence of who funded it.
7. Keep `refund_status` independent from merchant identity. A user-reported refund or third-party reimbursement can make an otherwise identified payment `not_counted_for_user`, but until the refund is verified in the live activity or a detailed export, label it `refunded_user_reported`, not confirmed. Preserve the original transaction IDs and do not add the PayPal evidence to official bank expenses.

Confidence is `strong` only with a named settlement, a complete installment sequence, exact total, and coherent dates; use `probable` for incomplete sequences, rounding differences, or a different currency; leave amount/date-only coincidences `unresolved`. Count only the bank debit in official totals: merchant settlement, 4X installments, and bank debit are evidence of one economic purchase, not three expenses.

See `references/paypal-4x-installment-reconciliation.md` for the detailed workflow and pitfalls.

## Live 4X inventory before unresolved-plan grouping

When the user's authenticated PayPal account exposes a dedicated `Paiement en 4X` page, inspect both **active/current** and **historical/completed** plans before turning generic CSV rows into grouped economic purchases. The live plan inventory has priority over pattern-based hypotheses about installment cadence.

Workflow:

1. Verify effective authenticated access by reading the rendered plan page; a successful login/OAuth screen alone is not evidence.
2. Enumerate every visible named plan in the active and history views, recording merchant label, purchase date, total, paid count, installment amounts, next/last date, payment instrument, status, and any displayed refund/adjustment.
3. Open each plan detail when possible. Preserve the literal merchant label and transaction/reference IDs; record currency differences instead of normalizing them away.
4. Compare the complete live inventory with the generic PayPal rows. A cadence/amount grouping that is not represented by a named live plan remains a **hypothesis**, not a confirmed 4X plan.
5. Report separately: (a) canonical generic rows unresolved, (b) grouped economic purchases only when independently supported, and (c) named live 4X plans. Do not convert “N grouped candidates” into “N products” unless the grouping is verified.
6. For plans with a future fourth installment, record it as future rather than missing. Preserve one-cent differences between paid installments and the displayed future amount.
7. Keep third-party ownership, merchant identity, refund status, and bank matching independent. A live merchant/refund detail can verify the PayPal event while the user's confirmation is still the source for who economically owns it.

A live inventory containing named plans but no additional unnamed plans is a valid negative result: it can demote prior inferred 4X groupings back to unresolved rows, but it does not identify the final merchants of those rows. Never erase the raw rows or force them into the named-plan list.

## Installment-to-bank-debit assignment (live-plan anchored)

Once a live plan inventory exists, generic `Pay Pal` bank debits can often be resolved to named merchants without guessing. Deterministic recipe:

1. For each live plan, build the expected installment series: purchase date + monthly cadence, installment amounts to the cent, and the observed bank-lag convention (e.g. Revolut debits land ~1 day after the PayPal date). Verify each expected date/amount against actual bank rows with code, under a one-to-one constraint.
2. A series qualifies for assignment only if every installment matches an unused bank row exactly AND the dates are coherent with the verified live plan's purchase/completion dates. One-cent differences within a plan are acceptable; a different total or shifted window is not.
3. **Total coincidence is not identity.** If an unmatched generic series sums to the same total as a known plan but its dates do not fit that plan's verified window (e.g. a 4×15,25 € = 60,99 € series starting months before the verified purchase date), leave it unresolved. Do not reassign the verified plan's rows to fit, and do not invent a second plan of the same amount.
4. After assignment, re-run the audit summary and report before/after review-queue counts and totals. Static reports generated earlier can retain stale numbers.

This pattern can clear most generic PayPal debits in bulk while leaving genuinely unexplained series visible in review — exactly the split the user wants ("deduce what you're sure of, keep only what you're not").

## Budget-view exclusion versus deletion

When a user suggests removing old unresolved PayPal payments from the budget, treat this as a scope/presentation decision, not as proof that the payments were not real expenses.

1. Identify the target before editing: the official workbook may contain only monthly aggregates, while the transaction-level audit is a derived view over immutable bank exports. Do not assume “budget” means the same file as the audit review queue.
2. Read the configured audit window and complete-month base (`START`, `END`, `BASE_START`, `BASE_END`, or the equivalent in the active implementation). Exclude only transactions outside the declared budget base; do not exclude in-base payments merely because they are old, generic, or still lack a merchant.
3. Preserve the raw bank row, PayPal evidence, mapping, and transaction ID. Represent the result as `historical_outside_budget_base` or an equivalent view filter; never delete the evidence or silently classify it as refunded/non-expense.
4. If the implementation already filters at load time, make no unnecessary data change. Verify through the actual API/view that pre-base rows are absent, in-base rows remain, and bank count/total are unchanged.
5. Record the decision in the financial journal, including the cutoff and the fact that the exclusion affects only the view. Re-run the audit summary after any mapping update; static reports can retain stale review counts.

This guardrail is distinct from third-party/refund handling: AETHERIS can be excluded from Walid's economic charges because ownership/refund evidence supports it, not merely because its date is old.

## Merchant matching guardrails

Use a one-to-one matching constraint and require more than amount/date coincidence:

- For generic PayPal evidence (`PayPal Inc.` or blank merchant), match only to a bank label explicitly showing PayPal or `Paiement 4X`. Do not attach it to `Ikea`, `Intermarché`, a family transfer, or another named merchant merely because amount and date align.
- For named PayPal evidence, require merchant-label overlap or an explicit PayPal bank label. If multiple payments share amount/date, downgrade or leave unresolved.
- Preserve the raw bank label even when a detailed PayPal record supplies the merchant and object.
- Keep unmatched evidence visible. Never force the review queue lower to make the audit look complete.
- A named merchant in a separate PayPal payment is not proof for every `PayPal Inc.` row in the same month.

Minimum mapping fields:

- raw source, raw row ID, audit transaction ID, account, date, amount, label;
- evidence provider, evidence transaction ID, date, gross, fees, net;
- exported merchant name and resolved merchant name;
- merchant status (`identified`, `intermediary_only`, `unresolved`);
- operation type, reference transaction ID, invoice/order/object details;
- relation type, method, confidence, status;
- counted bank transaction ID/amount and an explicit bank-debit-only rule.

## Reporting unresolved provider identities

Keep provider identity and bank reconciliation as two independent axes:

- `provider_status=unresolved` or `merchant_status=intermediary_only` means the final merchant is not proven; it does not mean the bank debit is missing.
- A payment can be bank-matched and still have no provider. Conversely, a named provider can remain bank-unmatched. Never report only the bank-unmatched subset when the user asks which providers are unknown.
- Build the canonical report from completed outgoing purchase events after transaction-ID deduplication. Exclude authorizations/memos, refunds, cancellations, reversals, deposits, withdrawals, conversions, transfers, and wallet movements. Explicitly exclude memo-like `Autre`/`T9900` rows when they are not economic purchases.
- For each unresolved canonical payment, retain date, amount, PayPal transaction ID, reference transaction ID, exported name, and a separate bank-match flag. Report counts and totals for both bank-matched and bank-unmatched subsets.
- A blank name, `PayPal Inc.`, generic payment type, invoice number, or product description alone does not prove a provider. Do not infer a merchant from amount/date coincidence, a nearby named payment, or an item title that is not itself a merchant identity.
- Use a compact, auditable table and state the exact source files, deduplication rule, excluded lifecycle events, and whether official financial files were left unchanged.

### Counting unresolved products versus rows

Never equate generic PayPal row count with product count. Report three separate values:

1. canonical unresolved payment rows;
2. grouped unresolved economic purchases/plans, where consecutive 4X installments are grouped only when cadence, amounts, references, or screenshot evidence support the grouping;
3. unique final merchants, which may be unknowable because several unresolved plans could belong to the same provider.

Use a strict/probable split. The strict count includes only merchants proven by a named settlement, a valid reference chain, or a complete/coherent 4X plan. A probable match (incomplete installment sequence, one-cent rounding, or a screenshot without a complete export chain) must be excluded from the strict count and shown separately. State clearly that PayPal evidence totals are not official bank expenditure totals.

Before answering a count, verify programmatically that every canonical row belongs to exactly one bucket: identified, probable, or unresolved; then verify that grouped-row membership sums to the canonical unresolved-row count. Do not reuse a prior headline such as “85” as a product count.

See `references/provider-unresolved-reporting.md` for the deterministic filter and output schema. For bulk-clearing a review queue ("deduce what you can, keep only what you're unsure of"), see `references/review-queue-deduction.md`. For the on-disk layout of the audit folder (`app/`, `data/`, `evidence/`, `reports/`, `scripts/`), launch commands, and path-fix pattern after moving files, see `references/audit-folder-structure.md`.

## Direct PayPal connection verification

If a PayPal MCP/OAuth connector is available:

1. install or enable it through Hermes' MCP setup flow;
2. complete OAuth in the user's browser without requesting credentials or 2FA codes;
3. verify the live connection with the provider test command and/or a read-only API call;
4. do not claim account access merely because the browser displays an OAuth success page;
5. if the live connector is not verified, use supplied detailed CSVs as the evidence source and state the limitation explicitly.

For a user-provided PayPal activity URL, verify effective access rather than trusting that the URL opened:

- inspect the final URL/title and rendered page after navigation;
- a redirect to a public PayPal home page, login page, CAPTCHA, or consent page is **not** account-history access;
- never request, enter, or retain the user's password, 2FA code, recovery code, or payment secrets; ask the user to log in manually and then re-check the page;
- inspect the URL's date range before drawing conclusions: a link filtered to a recent window cannot resolve older unresolved payments. Expand the period to cover the full audit scope, or explicitly report the uncovered dates;
- after access is verified, use read-only activity/detail views and capture transaction IDs, merchant, status, refunds, financing-plan information, and reference links before changing any derived classification.

Use read-only operations only for audit work. Do not create invoices, issue refunds, move money, change subscriptions, or alter PayPal records unless the user separately requests and confirms that action.

## Verification checklist

Before reporting:

- all supplied files parsed with explicit encoding/delimiter;
- overlapping exports deduplicated by literal transaction ID and union count reconciled;
- completed outgoing payments separated from authorizations, refunds, deposits, withdrawals, conversions, and memo-only `Autre`/`T9900` events;
- transaction IDs unique after deduplication;
- reference chains preserved and searched in both directions;
- generic PayPal evidence never mapped to an unrelated named bank merchant;
- PayPal 4X screenshots treated as PayPal evidence, with future installments distinguished from missing exports;
- third-party account use kept separate from economic ownership;
- strict and probable merchant counts reported separately;
- grouped unresolved-plan membership sums to unresolved canonical-row count;
- bank debit count and total unchanged;
- official workbook unchanged;
- review queue still includes unresolved merchant identities;
- direct connection status verified independently from OAuth UI success.
