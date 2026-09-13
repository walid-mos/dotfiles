---
name: spending-audit
description: Use for raw pro/perso spending audits.
version: 1.0.0
metadata:
  hermes:
    category: productivity
    tags: [finance, budgeting, audit, revolut, qonto, csv, pro-perso]
---

# Raw Spending Audit

Use this skill when the user wants a complete audit of personal and professional spending from raw bank exports, especially when merchant labels are inconsistent or a transaction can belong to either economic scope.

## Core contract

The goal is a reliable budgeting view, not a plausible-looking categorization. Preserve the evidence chain from raw transaction to final category, and never turn an inference into an official balance without validation.

### Source-of-truth boundaries

- Raw Revolut/Qonto exports are the transaction evidence: dates, labels, amounts, statuses and identifiers come from them.
- The official workbook remains the source of truth for live balances, debt totals and approved budgets.
- During an audit, do not copy provisional amounts into the official workbook.
- A derived report or local review app may store only stable transaction-ID → classification decisions; it must not become a second amount ledger.
- Read the decision journal before any write. Add a dated journal entry only for a real method or financial decision, not for a read-only calculation.

## Evidence-first workflow

1. Inventory the local exports and identify delimiter, date format, currency, status values, sign convention and row counts.
2. Parse programmatically, retaining raw labels and identifiers alongside normalized labels.
3. Filter to a declared period. Prefer the last 12 complete calendar months for budgeting and show the current partial month separately.
4. Reconcile the parser before categorizing: raw completed debit count must equal audit item count; raw debit sum must equal audit sum; identifiers must be unique; flow subtotals must sum to the global total.
5. Normalize merchant variants only for analysis. Never discard the raw label.
6. Classify with explicit confidence and a review reason. Unknown or mixed labels stay in a review queue.
7. Produce separate personal and professional views, then separate ordinary spending, debt/rattrapage pressure and internal transfers.
8. Do not call the budget final while a material review queue remains.

## Four-axis classification model

Keep these fields independent for every transaction:

1. **Payment account:** personal/Revolut or professional/Qonto.
2. **Economic owner:** personal, professional, internal flow or unknown.
3. **Nature:** macro-category and useful subcategory.
4. **Cash-flow status:** ordinary expense, debt/arrears, internal transfer, cash withdrawal or professional-paid-personally.

This prevents temporary financing, debt catch-up, tax/social payments, seizures, family-loan movements, pockets and salary transfers from inflating ordinary recurring budgets.

## Recommended taxonomy

### Personal macros

- Housing: current rent, arrears/rattrapage.
- Energy & home: electricity/gas, equipment/works.
- Food: groceries, restaurants/cafés/delivery.
- Transport: fuel, vehicle insurance, public transport/VTC/travel, repairs.
- Insurance: policies requiring contract confirmation.
- Telecom & digital: mobile, Apple services, professional telecom paid personally.
- Subscriptions & media: shared streaming, confirmed media subscriptions.
- Health & wellbeing: sport, pharmacy/health, pets.
- Leisure & culture: cinema/pass, games, outings and events.
- Shopping & daily life: online retail, clothing, beauty, gifts and flowers.
- Financing & debts: family loans, credit instalments, PayPal/Klarna pressure.
- Outside budget: internal pockets, transfers, cash withdrawals.
- To review: insufficient or mixed label.

### Professional macros

- Banking & financial fees.
- Telecom & digital.
- Accounting & legal.
- Hardware & leasing.
- Business tools & SaaS: cloud, email, AI, Adobe.
- Sales & marketing.
- Insurance.
- Business travel.
- Business meals: keep a justification/review flag.
- Tax & debts: TVA, URSSAF, DGFiP, seizure and collections.
- Outside budget: internal transfers, remuneration and employee-expense reimbursements.
- To review.

## High-risk inference rules

- Missing merchant labels or irregular payment dates do not prove an unpaid subscription. Reconcile by date, amount and raw operation first; prefer the user's explicit confirmation.
- Mixed Apple labels must stay reviewable when AppleCare is professional but iCloud/Music are personal.
- Generic cinema labels must stay distinct from an explicitly identified pass; old and current offers may have different normal prices.
- PayPal/Klarna are financing rails, not necessarily the final merchant or category. Keep them as temporary cash-flow pressure and request/collect the underlying purchase when needed.
- Professional AI, Orange pro and AppleCare can appear on the personal account temporarily; economic owner takes precedence over payment account.
- Family transfers may mix insurance, support, loans and repayments. Do not classify all transfers to the same person identically without transaction-level evidence.
- A monthly-looking label is not automatically a subscription: check active months, normal/base amount, exceptions and latest occurrence.

## Interactive review pattern

When ambiguity is material, build or use a local review layer that reads the original exports live. It should provide:

- Perso/Pro/All scope controls;
- review-only and all-transactions modes;
- search and flow filters;
- transaction-level drag-and-drop to subcategories;
- grouped-by-label drag-and-drop for repeated providers, with a transaction-level fallback for mixed merchants;
- persistent overrides keyed only by stable transaction IDs;
- visible confidence and review reasons;
- no automatic write to the official workbook.

After manual review, reconcile again and only then decide which categories become official budget lines.

## Output format

Lead with concise, readable personal and professional tables. For each meaningful line include: normalized category, period, count/active months, base or normal amount, exceptional/rattrapage amounts, latest date, confidence and action. Then provide:

- ordinary budget baseline;
- temporary debt/rattrapage pressure;
- internal transfers and non-expense movements;
- unresolved review queue;
- integrity checks and explicit limitations.

Never present provisional classifications as confirmed balances. State assumptions and preserve raw evidence paths.

## Verification checklist

- [ ] journal read before writes;
- [ ] source files and period declared;
- [ ] delimiter/sign/status/date handling verified;
- [ ] raw debit count equals audit count;
- [ ] raw debit sum equals audit sum;
- [ ] IDs unique;
- [ ] flow subtotals reconcile;
- [ ] debt/internal transfers excluded from ordinary baseline;
- [ ] ambiguous items remain reviewable;
- [ ] official workbook untouched until validation;
- [ ] final response separates pro and perso and stays concise.

See `references/raw-export-review.md` for the validated Revolut/Qonto parsing and interactive-review recipe.
