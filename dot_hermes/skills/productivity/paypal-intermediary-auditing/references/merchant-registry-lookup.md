# Resolving opaque bank labels against public business registries

Session-proven workflow (2026-08 audit): most cryptic bank labels (truncated merchant names, acquirer-style codes like `MELINA-DYLAN`, `CL77`, `LS TREGUSTO`, `IQ VAL D EUROPE`) are real registered French businesses and can be resolved without asking the user.

## Lookup sources, in order

1. `annuaire-entreprises.data.gouv.fr` — official, gives legal form + NAF/APE code. The NAF code alone settles the category: `56.10A/C` = restaurant/fast food, `47xx` = retail, `62xx` = IT.
2. `pappers.fr` / `societe.com` — same registry data, sometimes easier to hit via web_search.
3. PagesJaunes / official brand site — confirms the consumer-facing activity (e.g. UBRAC = restauration rapide Paris 16e; Tregusto = street food Bobigny).
4. For shopping-center receipts (`Aeroville`, mall names): the label may be the mall, not the shop — check the mall's store directory before classifying.

## Workflow

1. Collect all distinct unresolved labels with date, amount, account.
2. `web_search` each label (`"<label>" restaurant|boutique France`). Batch 3 searches per turn in parallel.
3. Accept an identification only when the NAF code or the brand's own site confirms the activity type. Record source URL in the note.
4. Classify from the verified activity, never from the label's appearance. Real traps found: **RAILWAY = Railway.app VPS hosting (SaaS pro), NOT rail transport**; Papothe.fr sells tea ware, not pharmacy; Difmark = game-key marketplace.
5. When the name matches several businesses (e.g. "Laura"), classify at low confidence and flag as probable — do not present as confirmed.

## Hard rule: no threshold heuristics

Do NOT generalize patterns like "small amounts = supermarket, medium = restaurant" into standing rules. In the 2026-08 session the user explicitly rejected this after it was written down: the pattern happened to hold on that day's sample only. Verify each label on its own evidence; ask the user only when registries fail.

## Delivering large review queues to the user

Static grouped markdown tables were rejected ("risque de rater des choses"). What worked:

- A self-contained local HTML page over the audit server (`/review` route serving a `review_dynamic.html`) with free-text filter, account/mount filters, sortable columns, click-to-select rows, running count+total of the selection, and copy/CSV export of the selection.
- Embed the row JSON inline in the HTML (`var DATA=[...]`) so the page works even if fetch fails, AND serve it over the local server. If the browser shows a stale blank version, cache-bust with `?v=2` or force-reload — served-file vs disk hash comparison identifies this instantly.
- The user then selects batches dynamically and hands back the CSV; the agent classifies exactly that batch with verification. Never pre-bucket by guessed type.

## Family-transfer conventions recorded 2026-08 (Walid)

- Spouse (Yasmine): incoming virements < 50 € are NEVER reimbursements of a purchase (immediate repayments, purchases made for her, small help); ≥ 50 € incoming shortly after a known purchase = probable reimbursement. Any residual price-minus-repayments is a gift by decision, never a "reste à charge".
- Sibling (Wided): outgoing = loans, repayment possible but not guaranteed → debt bucket.
- Parent (Abdelnnacer/Papa): outgoing = money owed (car insurance ~30 €/mois, death insurance ~30 €/mois, formerly parking) → debt bucket, never current spending.
