# ADR-0008: Bulk accessioning and the study-scoped freezer map

Status: accepted (2026-07-10)

## Context

Accessioning one specimen at a time and having no visual read on freezer
occupancy are throughput and usability gaps, not compliance gaps — the per-sample
custody and audit controls already exist (CoC-01, CoC-03). Two questions shaped
the build.

**How bulk accessioning takes input.** A count-with-shared-fields form (register
N tubes that share site/type) is simple and covers the common "we just received
a rack of the same specimen type" case. A CSV/manifest import (per-row subject,
type, collection time) is more powerful — it handles many subjects at once — but
is a materially bigger build: file parsing, per-row validation, partial-failure
reporting.

**What a freezer map may reveal.** Boxes can be study-restricted or shared
infrastructure (`storage_unit.study_id` NULL). A shared box can hold samples from
several studies, and this system scopes visibility by study membership
everywhere else (per-study audit chains, membership-gated reads). A naive box
map would leak other studies' accession ids to anyone who can see the box.

## Decision

- **Bulk accessioning is count + shared fields.** `bulkAccessionSamples` reuses
  `accessionSample` in one `withActor` transaction to create `count` samples
  (1–96) sharing site, type, and optional subject/collection time — each still
  gets its own accession number and custody chain (CoC-01). No new permission:
  it reuses `sample.accession`. CSV/manifest import is a deferred follow-on.
- **Bulk can fill a box in the same transaction.** When a target box is given,
  the batch is placed sequentially from the first free position via `storeSample`
  (CoC-03), the plate/rack grid operation. Capacity is checked up front
  (`freeBoxPositions`); a shortfall or any mid-batch failure rolls the whole run
  back, so a bulk accession never lands half-placed.
- **The freezer map is read-only and study-scoped.** `GET
  /studies/:id/storage-units/:unitId/map` returns the box grid, this study's
  occupants (position + accession id + type, linked to the sample), and other
  studies' holdings as **positions only** (`othersOccupiedPositions`) — never
  their accession ids. Capacity stays honest (occupied vs total) without leaking
  cross-study identity. Placement stays on the existing single-sample and
  bulk-fill paths; the map does not move samples.

## Consequences

Throughput and a real occupancy view arrive without touching the schema or the
compliance surface — bulk is a composition of existing audited mutations, and
the map is a scoped read. The 96-sample cap keeps a bulk transaction bounded
(one plate); larger intakes wait for the CSV path.

The costs are deferred capability: heterogeneous manifest intake (many subjects,
mixed types) and interactive placement/drag-to-move on the map are both
unbuilt. The map's cross-study cells are deliberately opaque, which is the
correct trade for a shared box — a coordinator who needs to see everything in a
physical box will need an explicit cross-study report, not a widening of this
study-scoped view.
