# ADR-0007: Shipment custody handoff

Status: accepted (2026-07-10)

## Context

Trial biospecimens are collected at sites and shipped to a central lab. The
sample is out of anyone's physical custody while in transit, which is exactly
the window a chain of custody exists to cover. The vertical slice had no way to
move a batch of samples with an auditable handoff — the `transfer` custody event
type was reserved for it but unused, and `sample.status` had no in-transit state.

Several design points needed deciding:

- **What a shipment references.** A shipment moves from an origin to a
  destination. Sites are already modeled (`study → site`); the receiving lab in
  this single-deployment model is not a first-class entity yet.
- **How custody is recorded across the move.** One handoff, or one event per
  phase.
- **Who may send versus receive.** A single "manage shipments" authority, or a
  split matching the site-sends / central-receives division of labor.

Kits (empty collection containers sent out to sites) are related but are
logistics/inventory, not custody. They are deliberately out of scope here.

## Decision

- **Origin is a `site` reference; destination is a free-text label.** A
  `shipment` carries `origin_site_id` (optional FK) and a `destination` string
  (e.g. "Central Biorepository"), plus `carrier` and `tracking_number`. Modeling
  the receiving lab as a structured entity is deferred until there is a reason
  to (multi-facility routing); a label is enough to record the handoff today.
- **Two `transfer` custody events per sample, one per phase.** Shipping records a
  `transfer` event (`details.phase = "shipped"`) and moves the sample to
  `in_transit`, clearing its storage position. Receiving records a second
  `transfer` event (`details.phase = "received"`) and returns it to
  `registered`, ready to be stored at the destination. The custody chain thus
  shows departure and arrival as distinct, timestamped, attributed events. This
  is requirement **CoC-06**: a sample in transit keeps an unbroken custody
  record from origin to destination.
- **Send and receive are separate permissions.** `shipment.send` (create, pack,
  dispatch) and `shipment.receive` (accept at the destination) model the
  site → central separation of duties, consistent with this system's four-eyes
  posture elsewhere. The receiving-desk role (`accessioner`) gets `receive`
  only; bench and supervisory roles get both.
- **State machine:** `packed → in_transit → received`, guarded server-side
  (only a packed shipment ships; only an in-transit shipment is received).
  `cancelled` is reserved in the enum but not yet wired, following the project's
  reserve-the-enum-value convention for regulated tables.

A per-study `shipment_counter` allocates human-readable `shipment_number`s
(`STUDY-SHP-00001`), mirroring `accession_counter`; the unique constraint on
`shipment_number` is what guarantees identity.

## Consequences

The custody trail now spans the transit gap, which is the compliance-relevant
half of "kits & shipments" and the table-stakes flow for a trial biobank. A
sample cannot be in two open shipments at once, and only available samples
(`registered`/`in_storage`/`in_testing`) can be packed, so the in-transit state
is unambiguous.

The cost is a coarser destination model — free text rather than a facility
entity — which will need revisiting for multi-hop routing or when a receiving
facility must own storage. Kits remain unbuilt, so outbound-collection logistics
are still manual. Both are follow-ons, not rework: the `transfer` events and the
`shipment`/`shipment_item` tables are the durable part.
