# ADR-0014: Derivation and pooling lineage

Status: accepted (2026-07-10)

## Context

Aliquoting (ADR-0006) splits a specimen into like children of the same type,
conserving volume. Two other lineage operations were named as follow-ons and
share the `sample_lineage` table but differ in shape:

- **Derivation**: one parent produces a new *material type* — whole blood → DNA,
  tissue → RNA. The child is a different substance, not a fraction of the parent.
- **Pooling**: many parents combine into one specimen — several plasma draws
  pooled for an assay. The child has *multiple* parents.

`sample_lineage` already reserved `derivation` and `pool` relations, but there
were no operations, no matching custody event types (the `custody_event` CHECK
listed only through `aliquot`), and the sample-detail lineage view returned a
single parent — fine for aliquots, wrong for a pool.

## Decision

- **Derived and pooled children get their own top-level accession number**, not a
  parent-suffixed one. Unlike an aliquot (`…-00002.1`, a fraction of its parent),
  a derivative or a pool is a distinct specimen, so it draws the next number from
  the study's `accession_counter` like any accession.
- **Each operation writes lineage rows plus a matching custody event.**
  `deriveSample` writes one `derivation` lineage row and a `derivation` custody
  event on parent and child; `poolSamples` writes a `pool` lineage row per parent
  and a `pool` custody event on the pooled child and every parent. Migration 0009
  adds `derivation` and `pool` to the `custody_event` type CHECK so a derived or
  pooled specimen's chain of custody opens with an event that names its origin.
- **Sensible inheritance, with safe defaults.** A derivative inherits the
  parent's subject and study-event references (it is still that subject's
  material). A pool inherits the shared type when all sources match (else the
  caller specifies `pooledType`) and the shared subject only when every source
  has the same one — a pool that mixes subjects has **no** subject key rather than
  a misleading one. Sources that are disposed, on hold, or depleted cannot be a
  derivation or pool source.
- **The detail view now returns all parents.** `lineage.parent` became
  `lineage.parents` (an array), so a pooled specimen shows every source; the UI
  groups children by relation (aliquots / derivatives / pools). Both operations
  reuse `sample.aliquot` as the bench-handling authority.

## Consequences

The specimen graph is now complete for the common biobank cases: split (aliquot),
transform (derive), and combine (pool), all in one audited `sample_lineage` with
custody events that explain each node's origin. Reusing the accession counter and
the existing lineage table meant one migration (a widened CHECK) and no new
tables.

The costs are the depth left out: derivation does not model yield/efficiency or a
protocol (which reagents, which method — that is the analytical/quality module),
pooling does not draw proportional volumes from each source or track a pooling
ratio, and there is no multi-level graph visualization beyond the immediate
parents/children on the detail page. These are lineage-depth follow-ons; the
audited derivation and pooling operations are the durable part.
