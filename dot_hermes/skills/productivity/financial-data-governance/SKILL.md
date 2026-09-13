---
name: financial-data-governance
description: "Use for readonly financial sources and derived mappings."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [finance, audit, source-of-truth, data-lineage, readonly, mappings]
    category: productivity
---

# Financial data governance

Use this skill when a financial workspace contains raw bank exports, official accounting workbooks, external evidence, classifications, reconciliations, or derived reports. The goal is a traceable pipeline with no invented amounts, no silent overwrites, and an explicit distinction between current balances and historical audit results.

## When to Use

Use this skill before auditing bank exports, rebuilding a transaction classification, reconciling external payment evidence, adding a new source version, or updating documentation that describes financial data lineage.

## Core source hierarchy

1. **Official workbook** — `finances.xlsx` is the source of truth for live balances, debt totals, provisions, and official financial totals. Never infer a live balance from a report, journal entry, or bank export alone.
2. **Raw bank exports** — Revolut and Qonto exports are authoritative for transaction dates, signs, amounts, account of payment, and raw labels for the covered period.
3. **External evidence** — PayPal, Klarna, invoices, screenshots, and merchant research explain or reconcile a bank line. They do not become additional expenses and never override the bank amount without explicit evidence.
4. **Derived data** — mappings, decisions, classifications, reports, and dashboards are reproducible outputs. They are not sources of current balances.

When sources disagree, stop and report the conflict. Do not choose the most convenient number.

## Raw-source layout and integrity

Walid keeps the workspace root strictly minimal: only live, active files (`finances.xlsx`, `journal-decisions.md`, `DOSSIER_FINANCIER.md`, `.hermes.md`). Everything received, dated, superseded, or finished belongs in a subfolder. He has explicitly rejected root-level clutter (backup xlsx files, raw email-dump folders like `URSSAF_EMAILS_<date>/`). The canonical placement table lives in `DOSSIER_FINANCIER.md` (« Structure du dossier Finances ») — follow it:

- New bank export → `SOURCES/<banque>/` + MANIFEST update.
- Received invoice/administrative justification → `Archives/Justificatifs/`.
- Legal mail, `.eml`, huissier/URSSAF/DGFiP correspondence → `Archives/Correspondance/<sujet>_<date>/`.
- Superseded workbook snapshots → `Archives/` with date suffix; delete once the operation they guarded is validated.
- Audit campaign artifacts → under `Audits/<campagne>/`: `app/` (interactive HTML + server + work sqlite), `data/` (derived mappings/classifications), `evidence/` (external proof transcripts), `reports/` (human-readable md), `scripts/`, plus any import-target subfolder.

Never leave backups, `.DS_Store`, temp files, or iCloud duplicates (« fichier 2 ») at the root.

### Destructive cleanup: verify before deleting

When asked to clean up suspected junk files, verify first — Walid expects deletion only of confirmed garbage:

- iCloud duplicates named « filename 2 » are sync-conflict copies and often *partial* (older) versions. Diff programmatically (entry count, subset check) before removing; a superset/original must survive.
- Backups created before a specific operation (e.g. `*.backup-<date>-before-*`) can be deleted once the user confirms the operation succeeded — but confirm scope when two similar snapshots exist.

Keep raw exports in one append-only tree:

```text
Finances/
├── SOURCES/
│   ├── revolut/     # personal Revolut exports
│   ├── qonto/       # professional Qonto exports
│   ├── MANIFEST.json
│   └── README.md
├── finances.xlsx
├── DOSSIER_FINANCIER.md
├── journal-decisions.md
├── Audits/<audit>/
│   ├── app/          # interactive layer: html, server, work sqlite
│   ├── data/
│   ├── evidence/
│   ├── reports/
│   └── scripts/
└── Archives/
    ├── Justificatifs/
    ├── Correspondance/<sujet>_<date>/
    └── *.xlsx        # dated workbook snapshots
```

- Treat `SOURCES/` as READ-ONLY by convention. Do not edit, rename, replace, or delete a source unless Walid explicitly asks.
- Prefer a manifest and verification over filesystem permissions. Do not add `chmod` requirements to an iCloud-synchronised workspace unless explicitly requested.
- Add new exports as new files; do not silently replace an existing export.
- `MANIFEST.json` records the relative path, byte size, SHA-256, addition date, and provenance.
- Verify every listed file and reject every unlisted export before analysis. A hash mismatch is a hard stop, not a warning.
- Use the reusable verifier in `scripts/verify_sources.py` when available; keep it read-only.

See `references/source-layout-and-manifest.md` for the manifest contract and a safe update recipe, `references/email-evidence-retrieval.md` for the mailbox read-only recipe (including himalaya parsing pitfalls, the Outlook throttling pattern, and the Qonto statement-emails-no-attachments finding), `references/invoice-mail-harvesting.md` for the validated invoice-harvesting + Qonto-reconciliation pipeline, and `references/financial-bot-cron-pattern.md` for the bounded metadata-only mailbox-watch architecture.

## Classification and lineage

Build a stable transaction identifier from the source scope and row identity. Every derived row should retain, at minimum:

- source file and raw row identifier;
- stable audit transaction identifier;
- raw date, signed amount, account, and label;
- economic scope: personal, professional, internal, or unresolved;
- category and optional subcategory;
- flow type: expense, income, debt/obligation, transfer, withdrawal, or provision;
- decision note, confidence, and evidence references when relevant.

Before finalizing a mapping:

1. Load and verify the raw sources.
2. Preserve raw values exactly; normalize only in a separate derived field.
3. Apply explicit user decisions before heuristics.
4. Keep ambiguous transactions unresolved rather than guessing.
5. Require zero unmapped rows only when every row has a defensible classification; report the count and total.
6. Reconcile row count and total amount against the raw exports, including cent-level differences.
7. Write the derived mapping and a dated journal entry; never write it back into the raw exports.

For a multi-item audit, aggregate and verify counts programmatically. Never claim a total that was not recalculated from the output file.

## Pro/personal separation

- Revolut is personal; Qonto is professional unless an explicit user decision says the economic owner differs.
- A professional expense paid from Revolut or a personal expense paid from Qonto is classified through the single bridge category `🔀 Utilisé le mauvais compte`; do not let the payment account silently decide the economic category.
- Internal transfers, recharges, cash withdrawals before their use is known, and protected provisions are not consumption.
- The only bridge in the audit taxonomy is the wrong-account category. A salary transfer is the accounting bridge between the business and personal systems, not a reason to merge their expenses.
- TVA 20% and URSSAF 30% of professional HT receipts, plus 18% IR on personal remuneration, are protected provisions and must not be used to repay debts.

## User-confirmed classification rules

These are durable classification conventions for this workspace:

- Yasmine means couple exchanges and donations; do not reopen those transfers automatically.
- Wided and Rabha are donations with a zero receivable balance, not loans. Keep `🏦 Prêts accordés` available for genuine future loans only.
- Papa is debt/obligation context except car insurance, which remains `🚗 Voiture > Assurance`.
- Amazon and AliExpress are personal. Twitter/X, LinkedIn, Shopify, Railway, and Sosh SIM are professional.
- PayPal and Klarna are intermediary/evidence sources; never add their lines to already-counted bank debits.
- A generic intermediary label such as `PayPal Inc.` does not prove the final merchant. Require direct evidence or an explicit user confirmation.
- Grouped PayPal 4X or Klarna instalments represent one economic purchase or an already-counted bank debit; do not count instalments as separate purchases.

## Automated invoice forwarding (Qonto receipts shadow job)

Walid runs a cron shadow job (job id in `~/.hermes/cron/`, schedule 09:00/19:00, `no_agent`) that forwards provider invoices received on zoho to the Qonto receipts address `receipts-1gfyds41so0i@inbox.qonto.com` (Qonto OCRs them and links them to transactions). Script: `~/.hermes/scripts/qonto_receipts/forwarder.py`; state `qonto_receipts_state.json`, log `qonto_receipts_forwarded.jsonl`. Rules that hold for any extension of it:

- **Explicit standing authorization (2026-08-29)**: automatic sending WITHOUT per-invoice validation is allowed for that ONE destination only. The destination is hard-coded and any other recipient must be refused. Any new automated-mailbox-write use case needs its own explicit consent from Walid in the conversation.
- Format: real forward (`Fwd: <original subject>` + original body header + original PDFs as attachments), not a rebuilt mail — he asked for it and Qonto's OCR reads the original PDFs.
- Providers tracked: Anthropic, OpenRouter, Resend, Hetzner, Cloudflare, Stripe/X, Moonshot — the list lives at the top of the script.
- Default since-date is the deployment date; `--backfill YYYY-MM-DD` processes history. A manual test send must be recorded in the state file so the job never double-sends.
- `no_agent` cron delivers stdout verbatim and nothing when stdout is empty: the script must print only actions/errors, stay silent on a no-op run.

## Email and legal evidence retrieval

When financial or legal evidence arrives by email, use the read-only workflow in `references/email-evidence-retrieval.md`. Check both Inbox and Archive, compare recent messages across folders by their provider timestamps, preserve raw `.eml` and attachments outside `SOURCES/`, and do not mutate the mailbox. The destination address is routing evidence only: classify the economic owner from the named person/company, SIRET, dossier, debt wording, and any explicit user qualification. A message delivered to Nextnode can still be a Nextnode debt incurred au titre de Walid; do not force it into the generic personal-debt ledger or merge it with another URSSAF dossier. If a document shows matching debits and credits but leaves `Solde` blank, report the apparent offset and do not declare settlement from the document alone; however, an explicit user confirmation that they requested verification and that the study confirmed nothing remains is authoritative for the official update: record the standalone dossier at 0 €, preserve its identity, and exclude it from other active URSSAF lines. When a legal notice gives both a gross claim and blocked funds/net amount, record both explicitly and distinguish the ledger amount from the amount proposed for cash settlement. Legal documents requesting acquiescence, signature, an immediate payment order, or an installment commitment must be surfaced as requested actions, never silently accepted or executed.

## Historical budget retrieval

When Walid asks what was previously budgeted, treat it as a historical lookup, not a request to rebuild the current model. First identify the scenario he names (for example, a specific invoice and negotiated payment date), then search the journal, archived/current workbooks, and session history for that exact scenario. Quote the recorded assumptions and amounts, distinguish the historical plan from the current generic forecast, and do not substitute a freshly recalculated scenario. Do not modify official files unless he explicitly asks for an update. If the question is ambiguous, present the matching historical scenarios side by side rather than asserting one.

## Official-file and decision discipline

- Never modify `finances.xlsx` during an audit unless Walid explicitly requests the official update.
- Read `journal-decisions.md` before a financial change and append a dated entry after a confirmed decision or payment.
- Keep current context in `DOSSIER_FINANCIER.md`; keep historical decisions in the journal; never use either as a live balance source.
- When a report becomes stale, mark it historical and point to the current derived mapping instead of silently rewriting its historical snapshot.
- If a third-party application import is abandoned, delete only the generated artifacts requested by the user and preserve the taxonomy and mapping that remain useful for future migration.

## Updating the official workbook after a confirmed reclassification

When a user confirms that an existing bank line was economically misclassified, separate three things: the immutable raw line, the corrected economic classification, and any offsetting payment that is not yet present in the current export.

1. Identify the raw line exactly (account, timestamp, signed amount, label, and source cutoff). Do not infer the date or amount of a missing offsetting payment.
2. Read the current `finances.xlsx` first and use its live cells as the baseline. Historical journal totals may contain superseded snapshots or later corrections; never use them as the sole baseline.
3. Reconcile the economic pair, not just the net cash movement. A line previously treated as a repayment may become a new loan, while a later user-confirmed return is a separate repayment. The correction can therefore change the live debt even when the new loan and return net to zero.
4. Preserve the raw signed amount and label in the audit table. Change only the derived classification/impact, and record an unexported offset as a clearly marked manual adjustment with user provenance, unknown date, and pending source identifier.
5. Update every official sheet that carries the balance (debt register, attack plan, audit summary, and linked synthesis cells) while preserving formulas. Recalculate totals programmatically from the numeric cells; if no calculation engine is available, verify the formula expressions and the equivalent arithmetic explicitly, and set workbook recalculation on open.
   - **openpyxl row-insertion pitfall**: `ws.insert_rows()` shifts cells but does NOT adjust any formula. After inserting a row above a `TOTAL` row, manually rewrite the SUM range (`=SUM(C5:C9)` → `=SUM(C5:C10)`) AND every cross-sheet reference to the moved row (grep all sheets for `='Dettes perso'!C` etc. — Synthèse, Budget perso, audit links). Verify by reloading the saved file and asserting each formula string and each recomputed numeric total; do not trust the pre-save in-memory state (an earlier insert was silently lost because the script never called `save`).
   - **openpyxl merged-cell pitfall**: `insert_rows()` also does NOT move merged ranges, and writing to a `MergedCell` raises `AttributeError: value is read-only`. If a merged note (e.g. the « Priorités » row A12:G12 in `Dettes perso`) sits below the insertion point, capture its text first, `unmerge_cells`, insert the row, rewrite `TOTAL`/`SUM`, then re-merge at the new row and re-set the anchor cell. Enumerate `ws.merged_cells.ranges` for every sheet you touch before writing.
   - **Where a family-debt balance lives (update ALL of them)**: the `Dettes perso` row + its `TOTAL` SUM; every cross-sheet reference; the `Audit prêts familiaux` summary row AND its dated detail lines; the `Plan d'attaque` line; a dated `journal-decisions.md` entry; and a dated snapshot in `Archives/` copied before the first save.
   - **Splitting one lender's balance by economic nature**: when money arrives with a distinct qualification (e.g. an investment made in Walid's name alongside a classic loan), create a SEPARATE register line (e.g. « Loubna (investissement) ») instead of merging it into the existing loan line — per the user's explicit instruction. Keep the audit summary coherent: exclude the split amount from the summary's « Nouveaux prêts » column so the recalculated solde equals the classic-loan register cell; add a note row stating the exclusion rule, and add one detail line per movement marked « hors export bancaire — date/identifiant à rattacher au prochain export » when the transfer postdates the export cutoff.
6. Append a dated journal entry that states the source cutoff, the user confirmation, the before/after totals, and what still needs to be attached to the next export.

This workflow avoids double counting, prevents a stale journal snapshot from overwriting the workbook's source-of-truth state, and keeps missing bank evidence distinguishable from a raw transaction.

## Restructuring an audit campaign folder

When reorganizing an existing audit folder (moving files into `app/`, `data/`, `evidence/`, etc.), scripts break silently because they cache absolute or relative paths computed at import time. Sequence:

1. Move files first, then grep every `.py` for path constants (`ROOT = Path(__file__)...`, hardcoded `/Users/...` paths, file names of moved JSONs/sqlite/html).
2. Common fixes: `Path(__file__).resolve().parent` becomes `.parents[N]` matching new depth; subfolder references gain the intermediate directory; hardcode-purge by deriving from a single ROOT constant.
3. Verify by importing: `sys.path.insert(0,'app'); import audit_server` then assert every declared constant `.exists()` — expect False results on the first pass and iterate until all True. Watch off-by-one on `parents[]`: `parents[0]` is the file's own directory's parent chain start, so switching to `parents[1]` changes FINANCES_DIR resolution too.
4. Update the README (folder map + launch commands, e.g. `python3 app/audit_server.py`) so documentation matches.
5. Smoke-test end-to-end with any `--once` / report mode before declaring done.

## Installment-plan and utility debts (échéanciers)

A negotiated installment plan may exist as a monthly charge line in `Charges récurrentes` / `Budget perso` while its **capital is absent from the debt registers** — Walid has forgotten such debts before (Engie). When he asks whether a supplier debt exists or how much remains, do not answer from the register alone: search the journal and session history for the échéancier, reconstruct the residual from archived invoices + client-space payments + bank exports, and state the assumptions explicitly. See `references/utility-debt-reconstruction.md` for the worked Engie method — including the double-counting pitfall (arrears folded into the next bimonthly invoice), the rule that **Walid's stated balance outranks any reconstruction** (a document-based residual is a floor; unbilled current consumption can make the live client-space balance higher), and the express-family-loan pattern (quick lender loan + same-day supplier settlement recorded as two visible movements).

## Verification checklist

Before delivering an audit result:

- [ ] source manifest passes;
- [ ] no raw source was modified;
- [ ] source row count and total reconcile;
- [ ] every final mapping has a valid source identifier;
- [ ] unmapped count is explicitly checked;
- [ ] pro/personal and neutral-flow rules are applied;
- [ ] external evidence is not double-counted;
- [ ] official workbook is unchanged unless explicitly requested;
- [ ] no debt claim (remaining balance, arrears, échéancier residual) is asserted without an invoice/payment reconstruction or an explicit user figure;
- [ ] documentation and journal reflect durable decisions;
- [ ] output paths are verified on disk.

The Money Manager SQLite skill remains the app-specific reference for Core Data schema details; this skill governs source integrity and financial lineage across tools.
