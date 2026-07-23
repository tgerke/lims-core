---
title: Why lims-core
description: The case for lims-core for decision-makers, and an honest account of what it is not yet.
---

Most laboratory information management systems treat compliance as a layer of
application features bolted onto a general-purpose data store: an audit log the
software writes when it remembers to, permissions checked in application code, a
signature that is a row like any other. lims-core inverts that. The controls a
regulated biobank depends on are properties of the database schema, enforced
below the application, where a bug or a rushed hotfix cannot reach them.

This page is for the people deciding whether that difference is worth building
on: laboratory and program leadership, data managers, and the QA and audit
functions that have to stand behind the record.

## Compliance as schema, not as feature

The append-only audit trail is hash-chained and written by database triggers,
not by application code. Results are versioned rows that can never be
overwritten; a correction keeps the prior value and requires a stated reason.
Signatures are cryptographically bound to the exact record version they approve.
The application connects as a least-privilege role that cannot alter any of this:
it cannot insert audit rows, and direct `UPDATE` or `DELETE` on the regulated
tables fails by trigger.

In practice, the tamper-evidence does not depend on the application behaving
correctly. Anyone with review rights can recompute the hash
chain and prove the record has not been altered after the fact. Every guarantee
on the [compliance page](/lims-core/compliance/) traces to a database behavior
and an automated test that names its requirement ID, and the full mapping lives
in a
[traceability matrix](https://github.com/tgerke/lims-core/blob/main/docs/regulatory-traceability.md).

## Biobank and analytical on one core

Samples, tests, results, storage, and custody are modeled once. The biobank
workflow came first: accessioning, the freezer map, aliquot and derivation
lineage, shipments, collection kits, and consent-withdrawal holds. The
analytical layer is built on that same core as a set of modules, not a separate
product: per-service specifications, worksheets that consume reagent lots, QC
controls with Westgard rules, a run-level release gate, and certificates of
analysis. A lab that starts by banking specimens for trials can grow into
running assays on them without changing systems.

## References, never PHI

A specimen links to the EDC subject it was collected from by reference only: the
subject key and study-event identifier are pointers back to the electronic data
capture system, never patient health information. No subject-level clinical data
enters the LIMS. The boundary between specimen data and patient data is
architecture, not configuration, which keeps the exports and the manifest CSV
PHI-free by construction.

## A modern, open stack {#modern-stack}

lims-core is TypeScript, PostgreSQL, and React, not a legacy Java and Oracle
platform. That is a far easier maintenance and hiring story, and it is the
reason the compliance substrate could be pushed down into the database in the
first place. Because it is AGPL-3.0 licensed, nobody can take the code and sell
it back to you as a closed platform, and because the data lives in a Postgres
database you own, your specimen inventory and its full custody record are
queryable directly rather than trapped behind a vendor reporting layer.

## What lims-core is not, yet

An honest read matters more than a sales sheet. lims-core is a broad, working
build on a production-shaped compliance core, but it is **not yet a validated
production system** for running a regulated trial biobank, and **not a drop-in
replacement** for a large commercial LIMS. Those products carry an enormous
functional surface and a formal validation package (IQ/OQ/PQ) that attaches to a
specific installation.

Deliberately out of scope at this stage: instrument integration and
result capture (ASTM/LIS2-A2, HL7v2), stability studies, an electronic lab
notebook, a no-code workflow designer, dashboards and ad-hoc analytics,
document and SOP management, deviation and CAPA handling, and the formal
validation program itself. The [roadmap](/lims-core/roadmap/) is specific about
what exists, what is designed, and what is not started, and the
[completeness review](https://github.com/tgerke/lims-core/blob/main/docs/completeness-review.md)
is the code-checked gap analysis to read before planning any deployment.

The honest framing is an open, modern nucleus you can grow into that kind of
platform, not a replacement you can install next quarter. For a team that values
owning its compliance substrate and its data, that nucleus is the reason to
invest.

## The platform it belongs to

lims-core is the third sibling to
[edc-core](https://github.com/tgerke/edc-core) (electronic data capture) and
[ctms-core](https://github.com/tgerke/ctms-core) (clinical trial management).
The three are converging onto one interoperable platform, which is why the
specimen-to-subject boundary is a reference across systems rather than a copy of
patient data into the lab.
