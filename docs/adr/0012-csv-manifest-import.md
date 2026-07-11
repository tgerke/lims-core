# ADR-0012: CSV manifest import

Status: accepted (2026-07-10)

## Context

Count-based bulk accession (ADR-0008) covers "a rack of the same specimen type,"
but a real intake is usually a spreadsheet with a different subject, and
sometimes a different type and collection time, on every row. ADR-0008 named the
heterogeneous manifest import as the deferred follow-on, flagging its real cost:
file parsing, per-row validation, and a failure model.

Two decisions shaped the build.

- **Where parsing and validation happen.** Parse client-side and post structured
  rows, or post the raw CSV and validate on the server.
- **The failure model.** Import the valid rows and report the failures, or reject
  the entire file on any error.

## Decision

- **The server parses and validates the raw CSV.** The client reads the chosen
  file and posts its text; a pure `parseSampleManifest` (with a small RFC-4180
  `parseCsv`) is the single authority for structure, required columns
  (`site_oid`, `sample_type`), known specimen types, and date parsing. Keeping
  the parser server-side and pure makes it testable and means a scripted client
  or a future file-upload path gets the same validation.
- **Import is all-or-nothing with a per-row error report.** Every row is
  validated (including resolving `site_oid` to a site in the study) before
  anything is written; if any row fails, the response is a 400 listing each bad
  row by its file line number and nothing is accessioned. A regulated intake
  should not land half-imported and force someone to reconcile which specimens
  made it. On success, all rows accession in one `withActor` transaction, each
  with its own accession number and opened chain of custody (CoC-01), reusing
  `accessionSample` and the `sample.accession` permission.
- **Columns are EDC references only.** `site_oid`, `sample_type`, `subject_key`,
  `study_event_oid`, `collected_at` — the same PHI-free reference model as manual
  accession (the platform-spine rule). This mirrors the manifest *export*
  columns (ADR-0010), so a study can round-trip.

## Consequences

Heterogeneous intake — many subjects, mixed types and collection times in one
file — is now a single upload with authoritative server-side validation and a
clean failure mode. It reused the existing accession path, so it added a parser
and a route, no schema change.

The costs are the conveniences left out: no column mapping/aliasing (headers must
match), no dry-run preview before commit, no direct storage assignment in the
manifest, and true multipart file upload is still a client-reads-then-posts-text
shim rather than a streamed upload. These are import-ergonomics follow-ons; the
pure parser and the all-or-nothing transactional accession are the durable part.
