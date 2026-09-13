# Review-queue deduction pass (bulk-clear what is provable, keep the rest)

Use when the user asks to shrink a review queue ("déduis ce que tu peux, garde seulement ce dont tu n'es pas sûr"). The governing principle: classify by evidence and unambiguous label only; everything else stays visible for user decision. Never force classifications to make the queue look smaller.

## Deterministic procedure

1. Reload the live derived layer (do not trust static reports — they go stale after mapping/decision updates; re-run `audit_server.py --once` or equivalent before quoting numbers).
2. Group review rows by label, account, and amount pattern with code (not by eye). For each group decide one of:
   - **resolvable by verified evidence** (e.g. bank debit matches a live-verified 4X plan installment exactly: date + amount + one-to-one);
   - **resolvable by unambiguous merchant label** (e.g. McDonald's → meals, pharmacy → health) — but keep "merchant known / purpose to confirm" flags where tax or budget semantics matter (Qonto meals stay "à justifier");
   - **not resolvable** — family transfers (loan/donation/refund is the user's call), mixed-nature merchants (Amazon, generic Apple), unlabeled installments.
3. Write decisions only into the decision layer keyed by transaction ID, each with a short provenance note and timestamp. Decisions must be reversible; never edit raw exports or the official workbook.
4. Re-run the summary and report before → after count AND total, plus the labeled list of what remains and why each block needs the user.

## Guardrails

- A total coincidence between an unmatched series and a known plan is not identity (see SKILL.md § Installment-to-bank-debit assignment).
- Do not auto-classify family transfers even when counterparty is consistent; one explicit user rule may then clear the whole block in one pass.
- Keep ambiguous big-ticket items (single large debits) in review regardless of how obvious smaller siblings look.
- Offer the user the highest-leverage next block: one rule ("these are loan repayments") can clear dozens of rows at once.

## Reporting shape

Report as: cleared blocks (with counts and evidence class), remaining blocks (counts, amounts, and the specific question the user must answer), unchanged-integrity line (raw item count, bank total, official files untouched).

## User-rule cascade (second and later passes)

After the first deduction pass, the user answers questions per block. Each answer is a standing rule that can clear a whole block in one code pass — apply it to every matching row, not just the row discussed:

- **Counterparty balance rule**: for recurring counterparties where direction matters (spouse, relatives), compute full-window incoming vs outgoing totals with code before asking; the user often knows only the aggregate ("fais une balance entrée/sortie"). Classify per the user's rule on that balance (e.g. spouse = gifts/transfers by balance; lender = loans until repaid).
- **Direction check before classifying**: for transfers to relatives, verify the sign of the specific row first ("is this him giving me or me giving him?") instead of assuming all rows share one direction.
- **Merchant-family equivalences from the user**: an unfamiliar label may map to a known family via user knowledge (e.g. "Dfparis = Diamond Factory", "Allianz = former Friday insurance", an obscure label → pâtisserie). Record the equivalence in the decision note so future sessions reuse it.
- **One purchase split across channels**: two merchants can be one economic purchase (e.g. a ring paid partly via PayPal 4X, partly via another merchant). Link them explicitly with an anti-double-counting note.
- **Reimbursement linkage**: when the user says a payment was reimbursed by a third party, search the bank export for the incoming transfer (counterparty + plausible window) and cite it as evidence; classify the outgoing as family transfer / reimbursed, not net expense.
- **Ambiguous subscription vs purchase**: for generic app-store labels (Apple, Google), present a compact date/amount table and let the user split subscriptions from one-off purchases; then apply their mapping deterministically. Offer to check the linked email inbox for invoices rather than guessing.
- Keep genuinely uncertain big-ticket items open even after sibling rules clear smaller blocks — ask for verification (e.g. hardware purchase on the pro account) rather than inferring.
