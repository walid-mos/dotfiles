# accor-wording-audit — pipeline mechanics

Extends `SKILL.md`; this file holds the inventory, row format, gate commands and review procedure.

## Source and scope

Pin the prototype revision (clone `git@github.com:VianneyBertrand/drinks-menu-compliance`
into a task-owned temporary directory), record both commit SHAs, and delete only
that clone when finished. In a sandbox, verify which tools can access the host
clone before assigning readers; `bash` may run in a VM while `read`/`grep`/
`find` run on the host. A reader must have access to both source trees.

Full audit: inventory all scalar paths in both
`apps/menu-compliance/src/shared/i18n/locales/{fr,en}.json`, including flat
`_one`/`_other` keys. Key parity is required. Search TS/TSX for user-visible
literals (including ASCII-only EN, aria labels, placeholders, toasts and
errors); an accent-only search misses most of these. Categorize hits as catalog
usage, intentional literals, comments, or uncovered wording. Excluded screens
(`pages/forbidden/`, `pages/not-found/`, `app/ui/GateError`, `pages/login/`
after OIDC cutover) remain **accounted for** as excluded, never silently drop
keys from coverage. A proto-only feature is not an app finding.

Diff audit: compare app to the chosen base revision and inspect the proto diff
if it changed. Include added/modified catalog keys; keys used by changed
rendering components, changed `t()` calls, changed JSX composition and changed
prototype elements; and new/changed user-visible literals. Account separately
for deleted keys: confirm their UI was removed or replaced and record the
prototype counterpart. Deleted catalog paths cannot be fed to the row gate. Inspect dynamic
`t()` key construction and include every reachable key. Write the proven key
inventory as a newline-delimited `scope.keys`; if you cannot prove the scope,
run a full audit. The scope file is only a coverage assertion: it does not
compute impacted keys for you. Do not feed unreviewed `git diff` lines to the
gate as if they were a complete inventory.

## Catalog fast pass (before component readers)

The prototype dictionaries are TypeScript objects, not JSON. Do not compare
app FR to app EN. `catalog-prepare.mjs` statically extracts both languages
from `BO_DICT`, `TRANSLATIONS`, their `ROLE_LABELS` references and literal
TSX text/attributes/FR–EN ternaries using the app's installed TypeScript
parser. It does not execute prototype code. Arrays are inventoried; dynamic
entries and nonlocalized dictionary literals are listed in `unresolved`
rather than silently compared as text. JSX fragments, interpolations and
runtime-generated text still require source inspection: a JSX fragment may
be only part of the final rendered string. The prepared file contains the
prototype snapshot, both git revisions and **every** app key. The script
proposes a unique
bilingual exact match, a unique single-language match, or up to eight ranked
literal candidates for Jev; an empty shortlist goes straight to review.

```sh
node scripts/catalog-prepare.mjs <app-root> <prototype-root> prepared.json [--scope scope.keys] [--cache previous-review-report.json]
node scripts/catalog-judge.mjs prepared.json catalog-decisions.json
# Interrupted? Resume completed chunks without re-paying:
TYPESAFE_API_KEY=… node scripts/catalog-judge.mjs prepared.json resumed.json --reuse catalog-decisions.json.progress
```

Omit `--scope` for a full audit. A scoped audit still validates FR/EN parity
across the entire catalog and rejects missing or duplicate scope keys. The
first command makes **zero API calls**. The second asks Jev to select the
same prototype element or `no_match` from candidates, batching questions and
saving each completed chunk. Load `TYPESAFE_API_KEY` from the environment for
pending questions; a fully approved-cache run needs no key. `--cache` accepts
only a report produced by the current `catalog-close.mjs`, never a Jev result
or an unfingerprinted audit. It skips approved keys **before** candidate
shortlisting. `--reuse` separately replays Jev candidate choices when app FR/EN
and candidate sets match; those choices are still unapproved. Results carry
both locales, candidate refs, selected choice and confidence. Review
all `needsReview` decisions: one-language-only matches, reported wording
differences, `no_match`, no candidate, and confidence below the gate. Also
verify **every** proposed pairing against its actual app usage and prototype
element, including high-confidence and uniquely byte-identical suggestions;
`needsPairingCheck` remains true until that is done. The unique exact match
is not a pass without this check (identical words can label different
controls). A candidate outside the shortlist, a dynamic entry, and any JSX
literal are searched in source, not declared absent. Invalid or incomplete
answers block the audit. The scope inventory must reconcile with the result
count before review.

The catalog result `candidate_text_differs` means *the suggested strings
differ*, not that the prototype has that element. Conversely `no_match` may mean the element is in
JSX or outside the shortlist. Check both groups against app usage and the
whole prototype source, then classify **each non-cached app key** in `reviewed.json`:

| Decision | Evidence and action |
|---|---|
| `same_element_exact` | Confirmed same element and byte-identical FR/EN literals. |
| `same_element_composition` | Same element and final rendered string; cite how interpolation/JSX completes it. |
| `same_element_drift` | Same element, genuine wording drift; fix and rerun before closing. |
| `no_counterpart_justified` | No proto element, necessary app-only feature/state. Set `extraKind` to `dev_tool`, `production_state`, `accessibility` or `feature_extra`; the last requires `approvalRef`. |
| `no_counterpart_unnecessary` | No proto element, dead catalog key or unjustified extra behavior; record a cleanup proposal, never auto-delete it. |
| `uncertain` | Pairing or product intent cannot be proved; leave open for source/product review. |

Each object carries `key`, `usage: "app/file.tsx:line — role"` (or `"unused"`),
`protoRef: "prototype/file.tsx:line"` (or `"introuvable"`), and `decision`.
Every non-exact decision needs a specific `reason`. No-counterpart decisions
also require `searchEvidence` naming the searched prototype surfaces; an
unused key cannot be a justified extra. If Jev proposed another element, add
`overrideReason`. A `feature_extra` needs an approval reference before
acceptance. Do not call an extra "unnecessary" merely because it is absent
from the prototype: backend failures and dev widgets can be intentional.

```sh
node scripts/catalog-close.mjs catalog-decisions.json reviewed.json review-report.json [--removed removed.json]
```

The report partitions every scoped key and counts each decision. Supply
`reviewed.json` for **only non-cached keys**; it may be `[]` when all keys were
approved. Missing, duplicate or overridden cached reviews fail. Unresolved
drift, unnecessary wording or uncertainty leave exit code 1 **after** writing
the report. The gate recalculates the full source snapshot before closing: if
either tree or locale file changed after prepare, restart the catalog pass.
It validates evidence fields, not the truth of component citations: source
inspection is mandatory for the first approval.

### Source-fingerprinted review reuse

A closed report stores a SHA-256 per approved key. The fingerprint covers its
FR/EN values; every source file with a literal occurrence of that key and its
cited usage files; their transitive local imports; dynamic `t()`/`Trans`
callers; shared i18n, workspace UI code, relevant CSS/text sources and package
manifests; the matched prototype catalog entry, component occurrences and
translation logic. A no-counterpart approval hashes prototype code and text
sources under `src`/`public`, plus `index.html`, so a new counterpart
invalidates it. Whole-file hashes intentionally invalidate a key if an
unrelated edit touches one of its dependencies. The full source snapshot also
detects edits between prepare and close. Test/spec files are excluded; new
user-visible literals outside the catalog still need the separate inventory.

When a fingerprint matches, `catalog-prepare --cache` reuses its approved review
without Jev, source readers or new `reviewed.json` input. A changed/deleted
usage file, new key occurrence, updated dynamic caller, changed translation,
prototype entry or relevant shared source returns that key to review. Report
`approved-reused`, `stale`, `removed` and requests sent. The cache lists keys
removed from the current catalog: close them with `--removed removed.json`, an
array of `{ "key": "…", "reason": "UI removed/replaced at source ref…" }`
covering each deleted key once. Never use a previous audit without these
fingerprints as a cache; review it once to establish the baseline. When
source-based ambiguity remains, leave `uncertain` open rather than force a
cache hit. Do not launch a full-source reader for every Jev difference: the
selected prototype entry may be the wrong control or JSX fragment.

Group remaining source checks by component/feature (back-office navigation and
workspace; CRUD pages/panels; hotel side and tunnel; auth/gates). Give readers
disjoint key lists, relevant component paths and prototype references, not the
entire catalogs. One writer per output file. If two features share a key,
assign one owner and cite all usages or produce separate element-pair evidence
in `protoNote`; never choose the first usage as representative without
checking the others.

## Rows (`rows-<unit>.json`: array, one object per key)

```json
{
  "key": "venues.removeTitle",
  "usage": "apps/menu-compliance/src/.../VenueRemoveDialog.tsx:37 - dialog title",
  "composition": "t() interpolates {{name}}",
  "appFinal": { "en": "Remove {{name}}?", "fr": "Supprimer {{name}} ?" },
  "protoFinal": { "en": "Remove {{name}}?", "fr": "Supprimer {{name}} ?" },
  "protoRef": "src/components/steps/StepOutlets.tsx:78",
  "protoNote": "same dialog title; literal/interpolation checked"
}
```

`appFinal` and `protoFinal` contain the whole rendered text, not merely the
translation value. Check joins, sibling text, punctuation, NBSP, and runtime
interpolation. Leave placeholders as tokens; document the values or JSX that
prove equivalent output. Do not normalize accents, apostrophes, whitespace,
ellipsis, case or punctuation. If a proto literal represents one interpolated
instance, record its raw literal and normalization in `protoNote`; do not
pretend that matching one instance proves all input values. For plural forms,
use matching named form maps on both sides, e.g. `{"fr":{"one":"…",
"other":"…"},"en":{"one":"…","other":"…"}}`. The catalog
may keep these as flat `_one`/`_other` keys; do not conflate catalog paths
with the row's display forms. For no counterpart, use empty strings on both
locales and `protoRef: "introuvable"`; explain the search in `protoNote`.
An unused key gets `usage: "unused"` but still needs a faithful counterpart
or an explicit no-pair. Cite the **same element and role** (button vs button,
label vs label, aria-label vs aria-label) for all exact pairs as well as drift.
If a key is rendered in different elements, do not declare it exact until all
usages are checked. Reconcile those usages in the row notes; if they differ,
report each element explicitly for review.

Reader output: rows file only; return counts, unresolved dynamic usages,
uncertain pairings and anomalies, not the full JSON in the conversation.
Do not invent proto counterparts. A `no-pair` is a review item, not a pass.

## Gate

After source pairings are confirmed, compare **final rendered strings** for
every scoped key. `catalog-compare.mjs` validates row coverage and writes
byte-exact/different/no-pair judgments with **zero API calls**. Review every
non-exact judgment against the components; an accepted exception needs the
catalog review's explicit reason. Use `jev-judge.mjs` only when non-exact
composition still needs probabilistic classification, never to re-ask for a
catalog pairing. Use absolute paths outside the skill directory:

```sh
node scripts/catalog-compare.mjs [--scope scope.keys] fr.json en.json rows-*.json compared.jsonl
# Only for unresolved composition judgments:
TYPESAFE_API_KEY=… node scripts/jev-judge.mjs [--scope scope.keys] fr.json en.json rows-*.json judged.jsonl
TYPESAFE_API_KEY=… node scripts/jev-judge.mjs [--scope scope.keys] --reuse judged.jsonl fr.json en.json updated-rows-*.json regate.jsonl
```

`--scope` is omitted for a full audit. Do not paste secrets into command lines
or reports: load `TYPESAFE_API_KEY` from the existing secrets environment.
Validation rejects missing/extra/duplicate keys, FR/EN parity failure, missing
locales or references, mismatched plural forms, and inconsistent no-pair rows.
Both scripts flatten per key/locale/form: byte equality yields `exact`,
`introuvable` yields `no-pair`, and every other pair is flagged `differ` by the
offline comparison. When explicitly invoking Jev, only non-identical pairs
go to it in chunks of 60. Jev classifies `abstraction_only`,
`wording_differs`, `different_element`; the exact criteria live only in
`questionFor` in the script. `flagged` is no-pair, either non-abstraction
choice, or confidence < 0.95. Missing/invalid answers fail the whole run.

`--reuse` applies only to an unchanged id, app/proto text, usage, reference and
judge version. Changed pairs are judged anew; still-exact pairs never reach
Jev. After each completed chunk the script writes `<out.jsonl>.progress` with
completed judgments; if interrupted, pass that file to `--reuse` and choose a
**different** output name. The progress file is removed after a successful
run. A previous JSONL file is an input artifact, not a source of truth: if
source or mapping changed, rebuild the row first. Keep the previous file
separate from the new output. Each output line includes `judgeVersion` and
`{id,key,locale,form,app,proto,protoRef,usage,verdict,choice,confidence,flagged}`.

## Review and finish

For each flagged row, open the app usage and cited prototype element, check
their roles and complete rendered text, and use the catalog review's explicit
categories rather than treating every missing pair as acceptable. A true
same-element drift needs a fix; a no-counterpart state needs a documented
reason or an open cleanup/product decision. Verify cited exact mappings too:
identical words can label different elements. Batch source review by component
and reuse context; do not review the same key twice only because it appears
in FR and EN.

After fixes, rebuild affected rows from source and run the gate with `--reuse`.
Verify each fixed id is now `exact` or an evidenced abstraction; justified
extras retain their evidence and unnecessary/uncertain cases remain visible.
Report total keys, forms/pairs, exact, no-pair, reused, sent to Jev, flagged,
fixed, justified extras, unnecessary wording and unresolved decisions, plus
any excluded screens/literals and remaining limitations. Run existing project
checks for changed app files. Do not create tests unless the current request
explicitly authorizes them.
