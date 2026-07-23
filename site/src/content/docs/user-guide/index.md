---
title: User guide
description: The everyday lab tasks in lims-core, screen by screen, with no code.
---

This guide is for the people who handle specimens: the accessioner at the
receiving desk, the technician at the bench, the lab manager who verifies and
signs, and the monitor who reviews. It walks the everyday tasks — accessioning,
storing, shipping, aliquoting, running assays and QC, ordering tests, entering
and signing results, reading the audit trail — as they look in the app, with no
code.

One specimen moves through the whole system, and every action you take is
recorded as it happens. You never mark a step "done" as a separate bookkeeping
task: registering a specimen opens its chain of custody, storing it writes a
custody event, signing a result binds your signature to that exact result
version. The record is a byproduct of the work, not extra work.

## The workflow at a glance

| Step | Who typically does it | What it produces |
| --- | --- | --- |
| [Accession a specimen](/lims-core/user-guide/accessioning/) | Accessioner, technician | A `sample`, a per-study accession ID, and the first custody events. |
| [Label and store](/lims-core/user-guide/storage-and-custody/) | Accessioner, technician | A DataMatrix label and a freezer position, one specimen per position. |
| [Aliquot, derive, hold](/lims-core/user-guide/biobank-operations/) | Technician, supervisor | Child aliquots and derived materials with conserved volume, and consent-withdrawal holds. |
| [Ship and receive; kits](/lims-core/user-guide/shipments-and-kits/) | Technician | A shipment with a pack → ship → receive custody handoff, and outbound collection kits. |
| [Order a test, enter a result](/lims-core/user-guide/orders-and-results/) | Technician | A test order and a versioned, append-only result with a QC verdict. |
| [Run assays and QC](/lims-core/user-guide/analytical-testing/) | Technician | A worksheet/run consuming reagent lots, and a Certificate of Analysis. |
| [Review QC trends](/lims-core/user-guide/quality-control/) | Lab manager | A control board and a Levey-Jennings chart with Westgard verdicts. |
| [Verify and e-sign](/lims-core/user-guide/signatures/) | Lab manager | A four-eyes verification and a signature bound to the result. |
| [Review the audit trail](/lims-core/user-guide/audit-trail/) | Monitor, lab manager | A hash-chained history you can verify end to end. |

Supporting screens: a lab-wide [reagent/lot inventory](/lims-core/user-guide/inventory/) and
study-scoped [reports and exports](/lims-core/user-guide/reports/). Who can do what is grant-based
and scoped to a study — see [roles and access](/lims-core/user-guide/roles/). If you want to follow
along in the running app, [getting started](/lims-core/getting-started/) has the demo
accounts and the order to switch between them.

## Signing in

Sign in with single sign-on (OIDC) or a local password. Access is granted per
study and site, and your role decides what you can do. Because releasing a
result requires re-entering a password at signing time, anyone who signs needs
a local signing password even on a single-sign-on deployment — see
[e-signatures](/lims-core/user-guide/signatures/).

![The sign-in screen.](../../../assets/screenshots/01-login.png)

## Where to go next

**Biobank**

- [Accessioning](/lims-core/user-guide/accessioning/) — register specimens one at a time, in bulk,
  or from a CSV manifest, and open their custody.
- [Storage and custody](/lims-core/user-guide/storage-and-custody/) — labels, the freezer map, and
  the chain of custody.
- [Biobank operations](/lims-core/user-guide/biobank-operations/) — aliquoting, derivation,
  pooling, freeze-thaw, and consent-withdrawal holds.
- [Shipments and kits](/lims-core/user-guide/shipments-and-kits/) — the custody handoff and
  outbound collection kits.

**Analytical**

- [Orders and results](/lims-core/user-guide/orders-and-results/) — ordering tests, versioned
  results, specifications, and calculated values.
- [Analytical testing](/lims-core/user-guide/analytical-testing/) — worksheets, reagent
  consumption, the QC release gate, and certificates of analysis.
- [Quality control](/lims-core/user-guide/quality-control/) — control samples, Westgard rules, and
  Levey-Jennings trending.

**Compliance and supporting**

- [E-signatures](/lims-core/user-guide/signatures/) — verification, signing, and what a signature
  binds to.
- [The audit trail](/lims-core/user-guide/audit-trail/) — reading and verifying the record.
- [Reagent inventory](/lims-core/user-guide/inventory/) — the lab-wide catalog and consumption
  ledger.
- [Reports and exports](/lims-core/user-guide/reports/) — inventory counts, turnaround, and the
  manifest CSV.
- [Roles and access](/lims-core/user-guide/roles/) — who can do what, and why admins hold no lab
  authority.
- [Glossary](/lims-core/glossary/) — the biobank and system terms used throughout.
