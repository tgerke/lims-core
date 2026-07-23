---
title: Getting started
description: Run the full lims-core stack locally in five commands, with seeded demo accounts.
---

Run the whole stack locally in five commands. You need
[Podman](https://podman.io/) (or Docker), Node ≥ 22, and
[pnpm](https://pnpm.io/).

```sh
podman compose -f infra/compose.yaml up -d postgres   # Postgres 16 on :5434
pnpm install
pnpm --filter @lims-core/db db:migrate
pnpm --filter @lims-core/api db:seed-demo             # demo study, site, users
pnpm dev                                              # api :3001, web :5174
```

Open <http://localhost:5174> and sign in with one of the seeded demo accounts.

## Demo accounts

The seed creates one study (`DEMO-001`, site `SITE-01`), a freezer hierarchy,
a small test catalog, and four users:

| User | Password | Role |
| --- | --- | --- |
| `tchen` | `lims-demo-2026!` | Technician — accession, store, order, enter results |
| `mgarcia` | `lims-demo-2026!` | Lab manager — verify and sign |
| `rpatel` | `lims-demo-2026!` | Accessioner — accession and store only |
| `admin` | `lims-admin-2026!` | Lab admin + system admin |

:::caution
Demo passwords are printed by the seed script and are for local development
only. Never seed a real deployment with them.
:::

## Your first specimen

The fastest way to see the system's point is to run one specimen end to end,
switching accounts where the separation of duties requires it:

1. Sign in as `tchen` and [accession a specimen](/lims-core/user-guide/accessioning/).
2. [Label and store it](/lims-core/user-guide/storage-and-custody/) in a freezer
   position.
3. [Order a test and enter a result](/lims-core/user-guide/orders-and-results/).
4. Sign out, sign in as `mgarcia`, verify the result, and
   [e-sign it](/lims-core/user-guide/signatures/) — the password step-up will ask for
   `mgarcia`'s password again.
5. Open the [audit trail](/lims-core/user-guide/audit-trail/) and click **Verify
   chain** to prove nothing was altered along the way.

Every step you just performed is in that trail, attributed and hash-chained.
The [user guide](/lims-core/user-guide/) walks each screen in detail.

## What else the demo seeds

The seed also lands data so the wider workflows are worth clicking through
immediately: a volume-tracked whole-blood specimen ready to
[aliquot](/lims-core/user-guide/biobank-operations/), a received
[shipment](/lims-core/user-guide/shipments-and-kits/) and a delivered collection kit, a
[freezer box](/lims-core/user-guide/storage-and-custody/) with real occupancy, a
completed [worksheet run](/lims-core/user-guide/analytical-testing/), and a PSA
[QC control](/lims-core/user-guide/quality-control/) with a drift that warns then
rejects on the Levey-Jennings chart.
