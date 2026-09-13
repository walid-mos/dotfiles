# Audit folder structure — Audits/charges_YYYY-MM/

Validated layout adopted 26/08/2026 for `Finances/Audits/charges_2026-08/`. Apply the same shape to future audit folders instead of dumping all files flat at the root.

```
charges_2026-08/
├── README.md                  # entry point; documents the structure
├── app/                       # interactive audit app: audit.html, review_dynamic.html,
│                              #   taxonomie_schema.html, audit_server.py, money.sqlite
├── data/                      # derived/classified data: category_mapping_final.json,
│                              #   classification_decisions.json, mapping_register.{json,csv},
│                              #   review_pass_*.json, taxonomie_proposee.json, money_manager_import.tsv
├── evidence/                  # external proofs: klarna_screenshot_evidence.json,
│                              #   klarna_bank_reconciliation.json, paypal_live_4x_inventory_*.json
├── exports-money-manager/     # Money Manager import CSVs
├── reports/                   # human-readable reports (audit_report_derive.md, review_grouped_*.md)
└── scripts/                   # regenerable tools: build_mapping_register.py, remap_taxonomy.py
```

Rationale: separates *computed* (data/) from *proven* (evidence/) — consistent with the rule that every classification must be backed by verified evidence.

## Path-fix pattern after moving files

Scripts anchor everything off `AUDIT_DIR`/`ROOT = Path(__file__).resolve()`. After moving a script into `scripts/` or the server into `app/`, fix the anchors:

- `audit_server.py` (now in `app/`): `AUDIT_DIR = Path(__file__).resolve().parents[1]`, then `FINANCES_DIR = AUDIT_DIR.parents[1]`; point data/evidence/app-file paths at their subfolders.
- `build_mapping_register.py`: same ROOT change; outputs go to `data/`, Klarna input to `evidence/`.
- `remap_taxonomy.py`: `sys.path.insert(0, '<audit dir>/app')` before importing `audit_server`; writes output to `<audit dir>/data/`.

**Verify after every move**: `import audit_server` then assert each configured path exists (`PERSO_CSV`, `PRO_CSV`, `DECISIONS_FILE`, `KLARNA_EVIDENCE_FILE`, `MAPPING_FILE`, HTML files), and run `python3 app/audit_server.py --once` for a no-UI summary check (expect ~1505 items loaded).

## Launch commands (from the audit folder root)

```bash
python3 app/audit_server.py                 # interface at http://127.0.0.1:8765
python3 app/audit_server.py --once          # JSON summary, no server
python3 scripts/build_mapping_register.py   # regenerate mapping register
```

## Housekeeping pitfalls (iCloud Drive)

- iCloud sync collisions create partial duplicates named `journal-decisions 2.md` etc. Before treating one as real content, verify programmatically whether it is a strict subset of the canonical file (Python `b in a` on the text + compare `^## ` heading lists). If fully contained, delete it with user approval.
- One-off backups (`finances.backup-*.xlsx`) should not sit at the folder root; `Archives/` holds snapshots. Ask before deleting any backup.
