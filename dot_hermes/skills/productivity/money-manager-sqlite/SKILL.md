---
name: money-manager-sqlite
description: "Use for Money Manager app SQLite imports and repair."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [macos]
metadata:
  hermes:
    tags: [finance, sqlite, money-manager, core-data, import, mobile]
    category: productivity
---

# Money Manager SQLite integration

Use this skill when the user manages money with the Realbyte **Money Manager** mobile app and wants agent-audited transactions injected into it, a bulk import built, or a broken import repaired. Also applies when a `.mmbak` backup file needs reading or cross-checking against bank exports.

## File formats

- iPhone backups (`.mmbak`) and the on-device `money.sqlite` are the **same thing**: a bare Core Data SQLite with `Z*` tables (`ZINOUTCOME` transactions, `ZCATEGORY`, `ZASSET` accounts, `ZASSETGROUP` account groups, `ZETC` misc).
- Android exports differ (ZIP-wrapped SQLite, `INOUTCOME` non-CoreData columns) — do not assume this schema.
- Get the file via Finder (iPhone plugged in → Files tab → Money Mgr. folder → `money.sqlite`) or via the app's Backup → Export. There is no official API and no cloud sync unless the user enables iCloud backup inside the app.

## Schema facts that actually matter

- **Category hierarchy**: parent rows have `ZPUID IS NULL`; subcategories store the **parent's `ZUID` string** in `ZPUID`. Not the parent's rowid/PK.
- **Transaction → category**: only `ZCATEGORYUID` (the category's `ZUID` string) is read by the app. `ZCATEGORYID` / `ZCATEGORY_ID` stay `0`. Setting only `ZCATEGORYID` does nothing visible.
- **Amounts are always positive.** Direction comes entirely from `ZDO_TYPE`: `'0'` income, `'1'` expense, `'3'`/`'4'` transfers, `'7'`/`'8'` balance adjustments. A negative amount on a `'1'` row makes the app display nonsense.
- **Never invent sentinel UIDs** like `'-4'` for "unassigned/debt target". They render literally in the UI and corrupt stats.
- Accounts live in `ZASSET` with names in `ZNICNAME`; groups in `ZASSETGROUP`. Link accounts to groups through matching `ZUID` strings, not numeric ids.
- Dates are Core Data seconds since 2001-01-01 in `ZDATE`; keep `ZTXDATESTR` (ISO) in sync too.
- After any insert/update, bump `Z_PRIMARYKEY.Z_MAX` for touched tables.

## Injection workflow

1. Work on a copy. Never write the user's only copy.
2. Read the user's existing categories first. If the desired taxonomy is missing, insert parents then children with fresh unique `ZUID`s (e.g. incrementing integers work fine) and set child `ZPUID` = parent's `ZUID`.
3. Map every source transaction to `(account name, category name, subcategory name)` **before** touching the DB. Resolve names to PKs/UIds at insert time.
4. Insert with positive amounts and correct `ZDO_TYPE`; fill `ZDATE`, `ZTXDATESTR`, `ZASSETUID`, `ZCATEGORYUID`, `ZCONTENT`, `ZUID` (fresh UUID per row), and `ZMONEY`.
5. **Deduplicate before re-running.** If an injection script runs twice you will get exact duplicates. Key rows on `(date, amount, account, note/content)` and skip existing matches; verify with `SELECT COUNT(*)` before and after.
6. Verify by summing `ZAMOUNT` grouped by `ZDO_TYPE` against the bank-export total. The cent-exact match is the acceptance test.

## Repairing a broken import

Symptoms: app "reads anything", negative-looking expenses, literal `-4` categories, missing hierarchy.

1. Diff against a known-good original backup (schema + sample rows) to find what diverged.
2. Fix amounts: `UPDATE ... SET ZAMOUNT=ABS(...)` where `ZDO_TYPE IN ('0','1')`.
3. Replace sentinel category UIDs with real category UIDs resolved by name.
4. Rebuild `ZPUID` links: for each subcategory whose `ZPUID` is numeric or dangling, set it to the parent's actual `ZUID` string.
5. Delete orphaned category rows only after confirming zero `ZINOUTCOME` references.
6. Re-verify the total-sum invariant before handing back.

## Alternative: TSV bulk import (no SQLite surgery)

Money Manager also accepts a TSV via iTunes/Finder file sharing (`MoneyManager/import/import.tsv`): columns `Date (mm/dd/yyyy) · Account · Category · Subcategory · Note · Amount · Income/Expense · Description`. Constraints: accounts and categories must **already exist** in the app with exactly those names (import does not create them), so generate a companion checklist of accounts/categories/subcategories to create first. Prefer direct SQLite injection when the taxonomy itself must be created.

## Sync automation notes

- `ifuse`/`libfuse` cannot build on macOS (libfuse is Linux-only) — do not attempt.
- `pymobiledevice3` (pure Python) is the plausible route for USB file pull/push without Finder; untested as of writing.
- Practical fallback that always works: user drags `money.sqlite` out via Finder, agent edits, user drags the replacement back. Ask the user to make an in-app backup before any replacement.

## Pitfalls

- Do not run the injector twice without dedup — duplicates double your totals.
- Do not normalize currency or convert EUR cents; the app stores plain euro floats.
- Do not delete the user's manually entered historical rows to "clean up"; they may reconcile to nothing in bank exports but carry context.
- Static reports go stale fast during an active audit session: regenerate summaries after each mapping change instead of quoting earlier numbers.