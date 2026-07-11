# ADR-0010: Reporting and exports

Status: accepted (2026-07-10)

## Context

A study team's first operational questions are "how many samples do we have, of
what, and where," "how fast are we turning specimens around," and "give me a
spreadsheet of everything." The vertical slice had per-sample views but no
aggregate read and no export. This is a reporting surface, not a compliance
control — there are no regulated writes involved — so the requirement is to add
it without inventing authority or leaking across studies.

Two points needed deciding.

- **How reports are authorized.** A new `report.view` permission, or the existing
  study-membership gate that already guards the sample list and freezer map.
- **What "turnaround time" means** when the analytical workflow is still thin.
  The durations that are reliably present in the data, versus ones that need an
  assay pipeline that does not fully exist yet.

## Decision

- **Reports are read-only aggregates gated by study membership, no new
  permission.** `GET /studies/:id/reports/{inventory,turnaround,manifest.csv}`
  require only that the caller is a member of the study (or a system admin),
  matching every other read surface. Aggregating rows the caller can already list
  one by one grants no new access, so a separate permission would be ceremony.
  Everything is scoped to the one study — the manifest never includes another
  study's samples, consistent with the freezer-map privacy decision (ADR-0008).
- **Turnaround time is computed from timestamps already in the record.**
  `collection → receipt` comes from the sample's `collected_at`/`received_at`;
  `receipt → storage` comes from the `storage_add` custody event. Each is
  reported as n / median / average / max hours over the samples that have both
  endpoints. Assay turnaround (order → signed result) is deliberately left for
  when the analytical module lands rather than reported from the thin current
  order flow.
- **The manifest is a plain RFC-4180 CSV of EDC references only.** Columns are
  accession id, type, status, subject key and study-event OID (EDC references,
  never PHI — the platform-spine rule), site, collection/receipt times, storage
  location, and quantity. A leading `=`/`+`/`-`/`@` in any free-text cell is
  prefixed with a quote to defuse spreadsheet formula injection. The CSV shape
  and the turnaround math live in pure functions in `core/reports.ts` so they are
  testable without a database.

## Consequences

The three first-asked-for reports exist behind the same membership gate as the
rest of the app, with no schema change and no new authority to administer. The
turnaround metrics are honest about what the current data supports and will
extend naturally as the analytical workflow fills in.

The costs are the reports that are not here: no assay turnaround, no time-series
or trend charts, no scheduled/emailed reports, and no ad-hoc query builder. The
manifest is a full-study dump rather than a filtered/served query. These are
reporting-depth follow-ons; the aggregate endpoints and the study-scoped,
PHI-free export are the durable part.
