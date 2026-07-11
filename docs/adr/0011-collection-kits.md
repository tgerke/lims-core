# ADR-0011: Collection kits

Status: accepted (2026-07-10)

## Context

Before a site can collect specimens, it needs the containers — the labelled
tubes, cryovials, and swabs assembled centrally and shipped out. Tracking those
outbound kits is the other half of "kits & shipments"; ADR-0007 built the
inbound sample custody handoff and explicitly left kits as logistics for later.

The key question is whether a kit is a custody record. A shipment moves filled
samples and must keep an unbroken chain of custody (CoC-06), so each transition
writes a `custody_event`. A kit holds only empty containers — there is no
specimen, so there is nothing to keep custody of yet. Treating a kit like a
sample shipment would mean inventing custody events for objects that have no
custody.

## Decision

- **A kit is audited logistics, not sample custody.** New `kit`, `kit_item`, and
  `kit_counter` tables mirror the shipment shape (per-study number via
  `kit_counter`, `KIT-00042` identity from the unique `kit_number`), but there
  are no `custody_event` rows. The kit's own lifecycle is audited — `kit` and
  `kit_item` carry the standard `lims_audit()` trigger — so assembly and dispatch
  are attributable, without pretending empty tubes have a chain of custody.
- **One `kit.manage` authority covers the lifecycle.** Assemble → ship → deliver
  is lower-stakes than sample custody, so a single permission (held by
  `lab_admin`, `lab_manager`, `technician`) governs all three, rather than the
  send/receive split shipments use. A kit is bound to a `destination_site_id`
  (required — a kit is always going somewhere), carries free-text `carrier`,
  `tracking_number`, and `notes`, and lists its contents as `kit_item` rows
  (container type + quantity).
- **State machine:** `assembled → shipped → delivered`, guarded server-side, with
  `cancelled` reserved in the enum, following the reserve-the-value convention.
  `kit` is mutable (not append-only); the audit trigger records before/after on
  each transition.

## Consequences

Sites' inbound supply is now tracked with the same identity and audit discipline
as sample shipments, closing the "kits & shipments" gap end to end. The build
stayed small because a kit reuses the counter/number/status pattern and needs no
custody plumbing.

The costs are the integrations left out: a kit does not yet link to the samples
eventually collected into it (closing the loop from kit → accessioned specimen),
there is no par-level inventory or auto-reorder, and delivery is a manual
confirmation rather than a scan or a carrier webhook. These are logistics-depth
follow-ons; the audited kit lifecycle and its contents are the durable part.
