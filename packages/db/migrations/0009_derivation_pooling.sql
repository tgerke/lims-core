-- Derivation and pooling lineage (aliquot follow-on, ADR-0014). sample_lineage
-- already carries 'derivation' and 'pool' relations; this adds the matching
-- custody event types so a derived or pooled specimen's chain of custody opens
-- with an event that names its origin. Logic lives in
-- packages/core/src/derivation.ts.

ALTER TABLE custody_event DROP CONSTRAINT custody_event_event_type_check;
--> statement-breakpoint
ALTER TABLE custody_event ADD CONSTRAINT custody_event_event_type_check
  CHECK (event_type IN (
    'collection', 'receipt', 'storage_add', 'storage_remove', 'transfer',
    'aliquot', 'derivation', 'pool', 'hold', 'hold_release', 'disposal'
  ));
