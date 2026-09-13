---
name: financial-expense-auditing
description: Use for raw pro/personal expense audits and review queues.
version: 1.1.0
author: Hermes Agent
license: MIT
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [finance, expenses, audit, budgeting, csv, revolut, qonto, classification]
    category: productivity
---

# Financial Expense Auditing

Use this skill when the user wants a complete audit of raw personal and professional transactions, recurring-charge reconstruction, budget categories, or an interactive review queue.

## Core principle: one source of truth

Treat the original bank exports as the source of transaction amounts, dates, signs, and raw labels. A derived report or interactive app may store only transaction-id keyed classifications, annotations, and review decisions. Never copy approximate totals into the official workbook, and never modify the official workbook until ambiguous classifications have been validated.

For Walid's finance dossier, read `journal-decisions.md` before any financial-file modification. Keep current balances in `finances.xlsx`; keep audit classifications in a separate derived layer until approved.

## Required data model

Keep these dimensions separate for every transaction:

1. **Payment account** — Revolut/personal or Qonto/professional.
2. **Economic owner** — personal, professional, internal transfer, or unknown.
3. **Spending nature** — housing, food, transport, software, leisure, health, etc.
4. **Cash-flow status** — ordinary expense, debt/arrears, tax/social obligation, internal transfer, family transfer, or cash withdrawal.
5. **Confidence and review state** — automatic rule, manually validated, or needs review.

This prevents professional charges temporarily paid from the personal account from being counted as personal consumption, and prevents transfers, debt settlements, or arrears from inflating recurring budgets.

## Evidence-first workflow

1. Read the journal and inspect the available exports before changing any financial file.
2. Detect delimiters, encodings, field names, date formats, currencies, completed/executed states, and sign conventions programmatically.
3. Parse only valid EUR completed/executed rows. Preserve the raw description and raw row identity.
4. Choose a primary baseline of 12 complete calendar months. Display the current partial month separately. Use older data only for recurrence, historical pricing, or anomaly checks.
5. Normalize merchant variants while retaining raw examples. Do not merge a generic merchant label with a distinct subscription unless evidence supports it.
6. Classify deterministic cases with explicit rules; send mixed or weak-label cases to a review queue rather than guessing.
7. Reconcile raw counts and totals against the derived layer before reporting anything.
8. Let the user validate ambiguous items interactively; only then consider updating official budgets.
9. Before placing a transaction in the review queue or asking the user what a merchant does, consult the recurring-charge register, journal, persisted decisions, user notes, and existing evidence mappings. A documented recurring charge is not an unknown merely because its bank label or paying account varies.

## Recurring-charge gate

Run this gate before asking for merchant context:

- Reuse documented recurring charges and known provider roles first (for example subscriptions, insurance, rent, Apple services, and professional tools paid from the personal account).
- Separate the payment account from the economic owner: a Revolut debit can still be a known professional charge, and a Qonto debit can still be a documented personal charge when the dossier says so.
- Preserve a manual contradiction or uncertain note; do not overwrite it with an automatic rule. Ask only when the existing register, notes, and evidence conflict or do not establish the nature.
- Never force a classification merely to shrink the review queue. Report the remaining queue and its amount separately.

## Cross-platform evidence mapping

When a bank export must be related to an intermediary such as Klarna or PayPal, create a separate derived mapping register rather than copying intermediary rows into the budget or workbook. Preserve immutable raw-source identifiers and keep one mapping record per bank transaction/evidence relationship. At minimum, record the raw source and row ID, audit transaction ID, raw date/amount/label, evidence provider and ID, external date/amount/merchant, relation/matching method, confidence, review status, counted transaction ID/amount, and an explicit anti-double-counting rule.

Use the bank debit as the only counted expense. Klarna installments, Klarna plan totals, PayPal payments, refunds, wallet top-ups, and withdrawals are evidence or settlement layers until they are proven to represent a distinct bank movement. Distinguish an underlying purchase, an installment, and the bank debit; never present them as three expenses. For PayPal, preserve the operation type, gross/fee/net values, transaction and reference IDs, and merchant-resolution status. Treat generic `PAYPAL`, `Pay Pal`, `Paiement 4X`, and especially exported `Nom = PayPal Inc.` as intermediary-only evidence unless a detailed PayPal record proves the final merchant. A PayPal row with `Frais = 0` is not evidence of a PayPal fee. Never infer the underlying merchant from a generic label, and never match generic PayPal evidence to an unrelated bank merchant on amount/date coincidence alone. For Klarna, preserve installment number/total, plan total when visible, payment source, and unresolved grouped or wallet-funded rows.

Match programmatically using amount, date tolerance, source labels, and a one-to-one constraint; then assign `certain`, `probable`, `low`, or `unresolved`. For generic intermediary evidence, require an explicit intermediary label on the bank side; for named evidence, require merchant-label overlap or an explicit intermediary bank label. Keep unmatched and low-confidence rows visible, and verify mapping counts, unique raw IDs, API exposure, and unchanged bank totals before claiming completion. User notes should trigger a search/review of candidate transactions and may support a specific manual validation; storing the note alone is not sufficient.

See `references/mapping-register.md` for the reusable schema, matching recipe, and verification checklist. See `references/paypal-intermediary-reconciliation.md` for the PayPal-specific field checklist and matching guardrails.

## Taxonomy design

Use broad, useful parent categories with precise subcategories. At minimum include:

- Housing
- Energy and home
- Food
- Transport
- Insurance
- Telecom and digital
- Subscriptions and media
- Health and wellbeing
- Leisure and culture
- Shopping and daily life
- Accounting/legal
- Hardware/leasing
- Business tools/SaaS/AI
- Sales and marketing
- Professional travel/meals
- Taxes/social/debts
- Family transfers
- Internal flows
- To review

Do not collapse debt/arrears into an ordinary category. Show ordinary budgetable spending, obligations, and internal transfers as separate totals.

## Taxonomy alignment with the user's own app

Walid manages budgets in a mobile Money-Manager-style app and has his own validated taxonomy. When designing categories, ALIGN to his rather than inventing parallel ones. Validated structure (26/08/2026):

- **Level 1 is always the account**: Qonto = Pro, Revolut = Perso. The two sides never mix. The ONLY authorized bridge is a category `🔀 Utilisé le mauvais compte`: a charge paid from the wrong account transits there, then is reattributed to its true category — it is a routing correction, never a final expense category.
- **Perso** (from his app): 🏠 Logement · 🚗 Voiture · 🏍️ Moto · 🐈 Chats · 🥘 Alimentation · 🧘 Santé & Bien-être · 📱 Abonnements & Services · 🎭 Loisirs & Sorties · 👩‍❤️‍👨 Couple (incl. engagement ring, gifts to spouse/mother-in-law) · 🏦 Administratif · 🛍️ Divers · 🏦 Prêts accordés (no subcategories — global receivables tracking) · ⚖️ Dettes & obligations (no subcategories).
- **Debts follow "1 dette = 1 compte"** like his app: each debt (Sofinco, CA Consumer, Engie, DGFiP…) is tracked as its own account; repayments post to the category without distinction and detail is read account-by-account. A settled debt = a closed account. Never build per-creditor subcategories that will die with the debt.
- **Insurance owed to Papa is Voiture > Assurance**, not a debt.
- **Entrées d'argent are first-class**: Salaire Nextnode, Remboursements reçus, Prêts familiaux reçus, Remboursement frais pro (perso); Encaissements clients (pro). Plus neutral flows: 🔁 Transferts internes, 🐷 Provisions intouchables (TVA/URSSAF/IR), 🏧 Retraits espèces.
- A working implementation exists in `Audits/charges_2026-08/remap_taxonomy.py` + `category_mapping_final.json` (old macro/subcategory → new taxonomy mapping table; rerunnable).

### Parsing the user's budget-app backup (.mmbak)

A `.mmbak` file is a **SQLite database** (Core Data style): tables `ZCATEGORY` (ZNAME, ZUID, ZISDEL), `ZINOUTCOME` (transactions), `ZBUDGET`, etc. Gotchas:

- Join transactions to categories via `ZINOUTCOME.ZCATEGORYUID = ZCATEGORY.ZUID` — NOT `ZCATEGORYID`, which is 0/empty.
- Each manual entry appears TWICE (paired rows with `ZDO_TYPE` 3 and 4) — halve counts or deduplicate before totalling.
- Dates are Core Data timestamps (seconds since 2001-01-01).
- Manual entries are user-entered and trustworthy but incomplete (large uncategorized rows common); they corroborate, they never replace bank exports as source of truth. Cross-check unmatched manual rows against bank exports by date ±4 days and amount.
- Respect the workspace path guard: files outside allowed directories may be readable via direct sqlite3 but flagged — prefer asking or copying through approved channels.

## Interactive review layer

A local read-through app is appropriate when raw labels are too ambiguous to classify safely:

- Read the raw CSVs live at each API/page load; do not duplicate transaction amounts.
- Store only `{transaction_id: category/note/review metadata}` in the decision layer.
- Provide both transaction-level and grouped-by-label views. Grouping is convenient for repeated merchants but must be reversible for mixed suppliers such as PayPal, Klarna, Apple, Amazon, and generic Pathé.
- Add a free-text context note per transaction or group. Auto-save after a short debounce, save again on blur/Enter/button, and poll the derived view periodically while skipping refresh when a note field is focused.
- Notes are context for the next audit; they do not automatically become an official category unless the evidence and the user's wording are sufficiently explicit.
- Be precise about monitoring: the local app can poll and persist notes, but the chat agent is pull-based and must reread the decision/API when performing the next classification pass. Do not claim push notifications.
- **Dynamic selection over agent-chosen groupings.** Walid rejected static grouped tables ("j'aime pas trop ton groupement qui risque de rater des choses") — a fixed grouping decided before he sees the data forces him into the agent's categories (e.g. RAILWAY is a VPS hosting SaaS, not transport). Prefer serving a small dynamic picker page: live data, free-text filter, account/mount filters, click-to-select rows with shift-range, running count/total, and copy/CSV export of the selection. He then hands back exactly the rows he wants classified. Implementation: `Audits/charges_2026-08/review_dynamic.html` served by `audit_server.py` at `/review`. Two pitfalls learned there: embed the data inline as fallback (fetch may fail) AND re-embed after every classification pass — a stale embedded copy shows old rows; also browser cache serves old JS, so bump a query param (`?v=N`) when reopening.
- When the user pastes a batch of rows with per-row explanations, classify them in one code pass keyed on (date, account, amount), not one tool call per row.

## Family and spouse transfers

Do not label a family transfer as a donation or debt solely from the counterparty name. For a spouse such as Yasmine, use a neutral category like `Family transfers — loan / repayment / gift to qualify`. Show nearby incoming transfers as context (for example within ±7 days), but do not automatically match, net, or compensate them. A user note such as “remboursement du 22-08” can support manual validation of that specific transaction without rewriting the entire counterparty history.

Once the user states a standing rule for a counterparty, apply it to every matching row in one code pass and record the rule verbatim in each decision note. Confirmed rules for this dossier (26/08/2026):

- **Yasmine (wife)**: classify by full-window incoming/outgoing balance; the net difference is treated as gifts/conjugal transfer.
- **Wided**: loans — she repays sometimes; keep as `Financement & dettes`.
- **Papa (Abdelnnacer)**: money owed by Walid — monthly ~30 € death insurance + 30 € car insurance (formerly parking); classify as debt/obligation, not ordinary expense. Check the row's sign first: outgoing = Walid giving.
- **Rabha / other loans**: verify repayment by computing the counterparty balance before claiming "loan outstanding".
- **Amazon**: always personal purchases. **Allianz**: former home insurance (Friday acquired by Allianz), stopped early 2026. **Fleurs**: gifts for Yasmine and her mother. **Vincent Salur**: pâtisserie. **EDCLUB**: typing-tutor subscription (cancelled).
- One economic purchase can span two merchant labels (e.g. engagement ring via PayPal 4X Neve Jewels + Dfparis/Diamond Factory): link both with an anti-double-counting note instead of counting twice.
- A user-reported third-party reimbursement should be corroborated by finding the incoming bank transfer before reclassifying as reimbursed.

For ambiguous app-store labels (Apple etc.), present a compact date/amount table so the user can split subscriptions vs one-off purchases in one reply; invoices are findable in his Outlook inbox if needed.

## Merchant lookup via public business registries

Before asking the user what an opaque bank label is, search French public registries: `annuaire-entreprises.data.gouv.fr`, `pappers.fr`, `societe.com`, `pagesjaunes.fr`. This resolves most truncated/garbled labels cheaply:

- **NAF code tells you the nature**: `5610A`/`56.10C` = restaurant / fast food, `4719A` = department store, `5629B` = catering services. The legal name behind an opaque label often differs from the trading name (e.g. `MELINA-DYLAN` trades as "Alimentation Royale"; `IQ VAL D EUROPE` runs the Italian Queen restaurant).
- Short personal-sounding names can be real businesses (`Soujaan` → Soujaan Burger, La Courneuve). Verify before classifying as a person transfer.
- Record the source ("vérifié sur le web le JJ/MM/AAAA") in each decision note so later passes know which identifications were registry-backed vs guessed.
- When several rows remain unexplained, deliver a **grouped triage table** (group by type → label → count/total) so the user can validate whole groups in one reply instead of row by row.

### No generalized amount-threshold heuristics

Never convert a pattern observed on one batch into a standing rule like "small amounts = supermarket". Walid explicitly rejected this: an observation such as "under ~10 € these were Carrefour City/Franprix" was true only for that sample. For every unknown label, verify via registries or ask — regardless of amount.

Similarly for spouse transfers (Yasmine): incoming transfers ≥ 50 € may be reimbursements of a shared purchase; anything below 50 € has some other cause (instant repayment, something bought for her, one-off help) and must never be auto-matched to a purchase — even within a documented reimbursement window after a large purchase.

### Gifts versus partial reimbursements

When the user buys something for a spouse/family member and receives partial repayments, do NOT frame the shortfall as "reste à charge" (remaining cost). If the user says the difference is a gift, that is the final classification — the purchase is a personal expense whose repayments are family transfers, and no net-cost figure should be presented as an outstanding obligation.

### Bundled intermediary payments

Klarna/PayPal can debit several purchases as one bank row ("Bundled payment", e.g. `29klarna6`, `26klarna4`). When screenshot transcriptions show no merchant for these, they are genuinely unresolvable from exports alone — leave them in review and point the user at the Klarna app or his email invoices rather than guessing. Never split a bundled debit across hypothetical purchases.

## Validation checklist

Before final reporting:

- raw debit count equals derived item count;
- raw debit total equals derived total to the cent;
- transaction IDs are unique;
- sum of flow buckets equals global total;
- current partial month is not silently included in the complete-month baseline;
- review queue totals are shown separately;
- no debt or recurring-charge claim is made solely from an absent label;
- no official workbook cell is changed from an unvalidated inference.

See `references/raw-interactive-audit.md` for the implementation recipe, verification probes, and the proven note/polling pattern.
