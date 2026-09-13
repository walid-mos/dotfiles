# Utility-debt reconstruction (échéancier fournisseur d'énergie, ex. Engie)

Worked example from the Finances workspace (27/08/2026). Use this pattern whenever Walid asks about a supplier installment plan (échéancier) whose capital is not in the debt register.

## Sources to cross
1. **Archived invoices** — `Archives/Justificatifs/engie_facture_*.pdf`. Each shows: consumption lines, penalty lines (« PÉNALITÉS DE RETARD »), and a « Rappel du solde restant dû » line. The p.3 detail table decomposes the total: `éléments facturés + solde restant dû + pénalité = TOTAL`.
2. **Client-space payment history** (screenshot from Walid, tabbed by year) — rows Date / Type / Statut « Réglé » / Montant.
3. **Bank export** — Revolut lines labelled `Engie` / `To Engie S.a.`. Match payments 1:1 with the client-space rows (they agree to the cent in this case).

## The critical pitfall: arrears are folded into the next invoice
The June invoice total (433,87 €) = current consumption (199,89 €, which itself includes the 11,70 € late penalty on the unpaid April invoice) + the entire April invoice (233,98 €) as « Rappel du solde restant dû ». Summing invoices naiveley double-counts the arrears. Correct method:

```text
Facturé (hors facture déjà incluse dans la suivante) :  facture fév + facture juin
Payé (espace client « Réglé »)                       :  somme des paiements de l'année
Reste dû ≈                                            :  facturé − payé
```

Compute in Python, never in your head, and verify each invoice's internal decomposition (here 199,89 + 233,98 + 11,70 = 445,57 ≠ 433,87 facturé — a small remises/arrondi discrepancy; report it, don't force it).

## Installment-plan signals
- The negotiated plan (80 €/mois) appeared **as a separate line in `Charges récurrentes`**, not in `Dettes perso` — so the register genuinely lacks the capital. Check that sheet plus the journal entry of the date the plan was classified (25/08/2026) before concluding the debt is missing.
- No isolated 80 € prélèvements appear in the bank export; plan payments may be folded into the bimonthly invoices. Do not assume monthly bank rows exist.
- The invoice footer proposes « mensualisation » figures (114/117/124 €) — these are Engie's smoothing proposal, NOT the negotiated repayment amount. Never cite them as the échéancier.

## Session-history retrieval
The classification decisions (why 80 €/mois, which invoices were unpaid, Walid's corrections) live in past sessions, not in files. Search `session_search` for the supplier name + échéancier before estimating. Quote the historical session rather than re-deriving.

## Payment decomposition: ask Walid what each payment covered, then reconcile both readings
When Walid explains that a lump payment (e.g. 278,31 €) « was » a current invoice (~200 €) plus one plan instalment (~80 €), reconcile his decomposition against the invoice arithmetic instead of treating it as a contradiction of the facturé − payé method. Here both converge: 760,69 − 695,00 = 65,69 € ≈ one remaining 80 € instalment. The supplier keeps ONE global balance — mental labels (« facture » vs « échéancier ») don't create separate accounts, and each « Réglé » payment just erases the global residual.

## Walid's stated balance outranks any reconstruction
The invoice/payment reconstruction gives an *evidence-backed floor*, not the truth. Walid can know a higher real balance than every archived document shows (Engie case: reconstruction gave ~65,69 € residu, but the real amount due that day was **258,00 €** because August consumption, unbilled at the archive cutoff, sat in the client-space balance). When he names a figure:
1. Do NOT defend the computation or ask him to prove it. Accept it, note its provenance explicitly (« solde espace client confirmé par Walid le JJ/MM/AAAA »), and correct the register/journal the same way as any other authoritative update.
2. In this reference file / the journal, keep BOTH numbers documented: the reconstruction (~65,69 €) explains where the historical arrears went; his figure (258,00 €) is what was actually settled. Write one sentence on why they differ (unbilled current consumption vs. historical reconstruction).
3. Lesson generalized: a reconstruction derived from *documents dated before today* cannot see charges accrued after their date. When he asks « combien je dois ? », give the reconstruction AND flag that the live client-space balance may be higher and is the payment-relevant number.

## Express family loan used to settle a debt same day (prêt express)
Pattern (27/08/2026): Walid takes a quick +400 € loan from Loubna specifically to pay a supplier balance (258 € Engie) immediately. Register sequence:
- Lender side (`Audit prêts familiaux` Loubna block): add the loan row under `Nouveaux prêts` (D6 += 400), keeping raw-label provenance and the « hors export bancaire ; rattacher au prochain export » marker for every unexported flow.
- Debtor side (`Dettes perso`): set the supplier line to 0 with a SOLDÉE note naming the funding source.
- Keep BOTH movements visible (dette envers Loubna +400, dette Engie →0); do not net them into one line. State the leftover cash (400 − 258 = 142,00 €) only in the journal/narrative — no fake « cash reserve » line.
- One dated journal entry covers both legs plus the net-out decision. If several flows happened off-export (returned loans, express loans, same-day payments), list them together in that entry so the next export reconciliation ticks them off as a batch.

If the residual cannot be paid now, Walid requests a NEW échéancier for the remainder. Then a register row becomes appropriate even for a small residual (Engie 27/08/2026: 65,69 €, mensualité 80 €, « Septembre 2026 », note carrying the full reconstruction) — his inability to pay converts "negligible residual" into a live scheduled debt.

If the residual cannot be paid now, Walid requests a NEW échéancier for the remainder. Then a register row becomes appropriate even for a small residual (Engie 27/08/2026: 65,69 €, mensualité 80 €, « Septembre 2026 », note carrying the full reconstruction) — his inability to pay converts "negligible residual" into a live scheduled debt.

## Register decision
For a small residual (< ~100 €), Walid may prefer a note update on the `Charges récurrentes` échéancier line over a new debt-register row. Present both options with the exact total impact (e.g. +65,69 € → total général 71 082,50 €) and let him choose; always pair the change with a dated journal entry. Request the client-space displayed balance as ground truth whenever the reconstruction and his account disagree.
