# Source layout and manifest contract

## Canonical layout

```text
Finances/SOURCES/
├── revolut/     # personal Revolut exports
├── qonto/       # professional Qonto exports
├── MANIFEST.json
└── README.md
```

The manifest is relative to the `Finances/` root. Each entry should include:

```json
{
  "path": "SOURCES/revolut/export.csv",
  "sha256": "<64 lowercase hex characters>",
  "size": 123456,
  "added": "JJ/MM/AAAA",
  "source": "short provenance"
}
```

A top-level `rule` should state that the tree is read-only by convention and that explicit user approval is required for replacement or deletion.

## Safe update recipe

1. Put the new export beside older exports in the correct account folder. Do not overwrite an existing file.
2. Compute its byte size and SHA-256.
3. Add one manifest entry with the relative path, date, and provenance.
4. Run the read-only verifier before analysis.
5. Record the new source version in the audit README or journal when it changes the analysis scope.

## Verification behavior

The verifier must fail closed when:

- a manifest-listed file is missing;
- the byte size differs;
- the SHA-256 differs;
- a file exists in `SOURCES/revolut/` or `SOURCES/qonto/` but is absent from the manifest.

It must not modify the source files or the manifest. A successful verification is evidence of file integrity at that moment, not proof that the external bank export itself is complete or correct.

## iCloud note

For an iCloud-synchronised directory, use convention + manifest validation as the default. Do not require `chmod 444`: filesystem permission changes can interact poorly with sync workflows, and a hash check gives a deterministic, auditable signal without changing sync behavior.
