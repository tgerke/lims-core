# ADR-0015: Interactive freezer-map placement

Status: accepted (2026-07-10)

## Context

The freezer map (ADR-0008) was deliberately read-only: it showed a box's grid,
this study's occupants, and capacity, but placement stayed on the single-sample
`store` form and the bulk box-fill. Arranging a box — dropping an unstored tube
into a free well, or moving one from A1 to B2 — meant leaving the map. ADR-0008
named interactive placement as the follow-on.

The one real question is custody. `storeSample` appends a `storage_add` event,
which is correct for a first placement. But moving a stored sample is a *removal
then an add* — the trail should show it leaving one cell and arriving at another,
using the `storage_remove` event type reserved in `0000_init.sql` but never used.
Reusing `storeSample` for moves would lose the removal half.

## Decision

- **A dedicated `moveSample` handles place-and-relocate.** `POST
  /samples/:id/move` takes a box and a required position (a map click always
  targets a specific cell). If the sample was already stored elsewhere, it
  records a `storage_remove` at the old cell before the `storage_add` at the new
  one; a first placement records only the add. It reuses the `sample.store`
  permission and the same guards as storage (no disposed/depleted/on-hold, box
  study-scope, one-occupant-per-cell). `storeSample` is left unchanged so bulk
  and shipment-receive keep their append-only-add semantics.
- **The map grid is the interaction surface.** With `sample.store`, occupied
  cells become buttons that "pick up" the sample (highlighted), free cells become
  drop targets, and an "Arrange" panel offers a picker of unstored samples to
  place. Without the permission, the grid stays read-only with the cells linking
  to their samples, exactly as before. Placement never moves another study's
  sample — cross-study cells remain opaque and inert.

## Consequences

Arranging a box is now direct manipulation on the map, and every move leaves an
honest two-event custody trail (out of the old cell, into the new). It reused the
existing map, guards, and permission, so it added one core function and one route
— no schema change (the `storage_remove` type was already reserved).

The costs are the richer interactions left out: no true drag-and-drop (it is
click-to-pick, click-to-drop), no multi-select move, no cross-box drag in a
single gesture, and no rack/shelf-level rearrangement — only within the box in
view. These are interaction-polish follow-ons; the audited `moveSample` and the
clickable grid are the durable part.
