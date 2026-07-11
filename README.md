# lims-core

A modern, open-source **Laboratory Information Management System** for clinical
research — biospecimen/biobank management for trials first, with a
domain-neutral core designed to also serve analytical labs. Third sibling to
[`edc-core`](../edc-core) (Electronic Data Capture) and
[`ctms-core`](../ctms-core) (Clinical Trial Management); the three are
converging onto one interoperable platform.

Compliance is structural, not bolted on: 21 CFR Part 11 append-only audit and
e-signatures, plus specimen chain of custody, enforced in PostgreSQL via
triggers and a least-privilege application role — never trusted to application
code.

**Documentation & user guide:** <https://tgerke.github.io/lims-core/>

![A sample record: storage, chain of custody, DataMatrix label, and a versioned, verified, e-signed result](docs-site/images/04-sample-detail.png)

> **Status:** first end-to-end milestone. A strong foundation and working demo —
> not yet a production biobank system, and not a drop-in replacement for a
> commercial LIMS. See the [completeness review](docs/completeness-review.md)
> for an honest gap analysis.

## The vertical slice (what works today)

Accession a specimen → print a DataMatrix label → store it in a freezer
position → order a test → enter and verify a result (four-eyes, versioned) →
e-sign with password step-up → review the hash-chained audit trail and confirm
it verifies. Runs front-to-back with OIDC or password auth, grant-based RBAC
scoped to study/site, and a per-study append-only audit chain.

## Stack

pnpm workspaces · TypeScript 5.6 ESM · Fastify 5 + Zod 4 · Drizzle + PostgreSQL
16 · React 19 + Vite + TanStack + Tailwind · Biome · Vitest. See
[`docs/adr/0001`](docs/adr/0001-convergent-stack.md) for why.

## Quick start

```sh
podman compose -f infra/compose.yaml up -d postgres   # Postgres 16 on :5434
pnpm install
pnpm --filter @lims-core/db db:migrate
pnpm --filter @lims-core/api db:seed-demo             # demo study, site, users
pnpm dev                                              # api :3001, web :5174
```

Open http://localhost:5174 and sign in as `tchen` / `lims-demo-2026!`
(technician) to accession and store; `mgarcia` / `lims-demo-2026!`
(lab manager) to verify and sign.

## Layout

```
apps/api          Fastify API: auth, RBAC, slice routes, compliance tests
apps/web          React SPA: specimen list, accession, storage, results, audit
packages/db       Drizzle schema + hand-written SQL migrations (triggers/roles)
packages/core     Audited domain logic: withActor, custody, storage, results, esign
packages/schemas  Zod contracts shared client + server
packages/labels   DataMatrix + accession-ID generation (bwip-js)
docs/             plan, ADRs, regulatory-traceability matrix
```

## Compliance guarantees (all tested)

Direct `UPDATE`/`DELETE` on `audit_event` / `result` / `custody_event` /
`signature` fail by trigger; the runtime role cannot forge an audit event; a
tampered event fails `lims_verify_audit_chain()`; e-signing rejects a wrong
password. Each test cites its requirement ID —
see [`docs/regulatory-traceability.md`](docs/regulatory-traceability.md).

## Documentation

- [User guide & walkthrough](https://tgerke.github.io/lims-core/) (GitHub Pages)
- [Completeness review](docs/completeness-review.md) — vs. a CRO/pharma LIMS
- [Build plan & architecture](docs/plan.md)
- [Regulatory traceability matrix](docs/regulatory-traceability.md)
- [Architecture decision records](docs/adr/)

## License

AGPL-3.0-only.
