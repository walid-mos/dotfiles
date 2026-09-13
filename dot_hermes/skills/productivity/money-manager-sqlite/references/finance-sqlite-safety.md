# Finance SQLite safety reference

## Why the first replacement failed

A Core Data SQLite can pass a superficial row-count and sum check while the app still displays corrupted data. The app depends on internal relationships, direction fields, category UIDs, parent UIDs, primary-key metadata, and account/group links—not only on `ZINOUTCOME` totals.

Observed failure modes:

- expense amounts were written negative even though Money Manager stores amounts as positive and uses `ZDO_TYPE` for direction;
- sentinel category UID `-4` rendered as a literal category and broke classification;
- category hierarchy links must be checked against the exact parent `ZUID` string;
- deleting/recreating categories can orphan transaction references;
- rerunning an injector can create duplicates;
- balance-adjustment rows (`ZDO_TYPE` 7/8) must not be mistaken for ordinary income/expense rows;
- a matching total of 101,248.42 EUR is not proof that the app will read the database correctly.

## Required preflight

1. Make a byte-for-byte backup of the original `.mmbak`/`money.sqlite`.
2. Never edit the only copy supplied by the user.
3. Inventory schema, categories, accounts, groups, `Z_PRIMARYKEY`, and representative rows from the known-good database.
4. Resolve every category/account by name to its actual UID before inserting.
5. Build a deterministic import plan and check duplicate keys before any write.
6. Keep a rollback copy and a manifest of the generated artifact.

## Required postflight

1. Reopen the generated SQLite in read-only mode.
2. Verify foreign/key relationships, parent-child category links, account/group links, direction types, positive amounts, and primary-key metadata.
3. Compare counts and sums to the import plan, separately for expenses, income, transfers, and adjustments.
4. Check that no transaction points to a missing category/account or a sentinel UID.
5. Require an app-level smoke test after restoration: launch Money Manager, inspect account balances, category hierarchy, recent transactions, and a few known transactions. Database totals alone are insufficient.
6. Do not call a file “ready to sync” until the app-level test succeeds or the user explicitly accepts an untested artifact.

## User-specific classification rules

- Revolut is personal; Qonto is professional.
- The only cross-side classification is `Utilisé le mauvais compte`.
- Wided and Rabha are gifts/donations with a zero receivable balance, not loans.
- Papa is tracked separately for debts/obligations; car insurance paid to Papa remains `Voiture > Assurance`.
- URSSAF 2024 is a separate debt from any unrelated payment or seizure.
- When the user asks for names to enter manually, avoid parentheses and use at most one space between words.

## Safer alternative

When direct SQLite replacement is not fully tested, preserve the original app database and provide a validated import plan or TSV. Never claim that a generated SQLite is complete merely because its aggregate amount matches the bank exports.
