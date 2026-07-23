# lims-core — build plan

> **Handoff (Written 2026-07-10).** This file is both the plan and the session handoff.
> To resume in a fresh session: open a chat in `~/Documents/gh-repos/lims-core` and say
> *"Read `/Users/tgerke/.claude/plans/this-is-currently-an-jolly-flamingo.md` and continue."*
> The project memory index (`MEMORY.md` → `platform-convergence-vision`,
> `lims-core-biobank-plus-analytical`) auto-loads into any session opened in that repo.
>
> **Goal / definition of done for the first build:** a thin end-to-end vertical slice
> (accession specimen → label → store → order test → enter+verify result → e-sign →
> audit-trail view) running front-to-back with real OIDC auth, grant-based RBAC, and a
> hash-chained append-only audit trail, plus CI + validation-pack discipline.
>
> **Current state:** planning complete; repo is still empty (greenfield). No code written.
> Both sibling repos (`edc-core`, `ctms-core`) have been explored — their house styles and
> the canonical convergent stack are captured below. ExitPlanMode was declined; user is
> reviewing before implementation.
>
> **Decisions locked with the user:** (1) primary domain = biobank-for-trials, but build a
> domain-neutral core so it can also serve analytical labs later;
> (2) adopt `edc-core`'s toolchain as the platform standard + fold in `ctms-core`'s
> compliance machinery (converge all three repos); (3) first deliverable = thin vertical
> slice; (4) 21 CFR Part 11 + chain of custody structural from day one.
>
> **Next steps (ordered):** first, on approval, copy this plan into the repo as
> `docs/plan.md` (version-controlled + discoverable). Then scaffold the monorepo
> (pnpm workspaces, Biome, tsconfig.base, infra/compose.yaml), then port the audit-trigger
> + least-privilege-role SQL from the siblings, then build the slice's schema→routes→UI.
>
> **Gotchas:** `~/Documents/gh-repos/lims-core` reports `Is a git repository: false` — needs
> `git init`. Reuse (don't reinvent) the trigger pattern in `edc-core`
> `apps/api/drizzle/0001_audit_triggers.sql` and the `withActor` + least-priv role pattern in
> `ctms-core` `packages/db/migrations/0001`+`0004` and `core/src/actor.ts`.

## Context

`lims-core` is a new, greenfield, AGPL-3.0 open-source Laboratory Information Management System — the third sibling to `edc-core` (Electronic Data Capture) and `ctms-core` (Clinical Trial Management), living under `~/Documents/gh-repos/`. The goal is the same as the other two: a modern, open alternative to the expensive licensed LIMS platforms that today ship outmoded tech stacks and dated UX.

Two decisions from the user shape this plan:

1. **Domain:** biospecimen/biobank management for clinical trials is the primary need, but the system should be built so its shared core can *also* serve analytical LIMS use for academic labs. This is feasible because both share ~70% of the model. We build a domain-neutral sample/test/result/storage/workflow core, ship the **biobank vertical slice first**, and design the test-catalog/spec/CoA layer so analytical parity is a follow-on module, not a rewrite.
2. **Convergence:** the three repos should merge into one interoperable platform. `edc-core` is the newest, most complete sibling; its toolchain becomes the **canonical convergent stack**. `ctms-core`'s stronger compliance machinery is folded in. `ctms-core` currently lags (Hono, Zod 3, React 18, no lint/CI) and should migrate toward this target over time. This plan does *not* refactor the siblings — it establishes the shared conventions in `lims-core` and documents them so the others can follow.

**Compliance is structural from day one:** 21 CFR Part 11 (append-only audit, e-signatures) + specimen chain of custody, enforced in Postgres via triggers and a least-privilege app role — never trusted to application code. This matches the siblings' compliance-by-construction thesis.

**Intended outcome of this first build:** a thin, working, end-to-end vertical slice — accession a specimen → label it → store it in a freezer location → record a chain-of-custody event → order a test → enter and verify a result → e-sign → inspect the audit trail — running front-to-back with real auth, RBAC, and a hash-chained audit trail, plus the CI/validation-pack discipline the siblings established.

---

## Canonical convergent stack

Adopt `edc-core`'s toolchain as the platform standard; fold in `ctms-core`'s compliance refinements.

| Layer | Choice | Source |
| --- | --- | --- |
| Monorepo | pnpm 11 workspaces, Node ≥22, TypeScript 5.6 ESM, one strict `tsconfig.base` | edc |
| Lint/format | Biome 2.x (single tool) | edc |
| Backend | Fastify 5 + Zod 4, OpenAPI-documented, thin routes / fat services | edc |
| ORM / DB | Drizzle 0.45 + postgres.js on PostgreSQL 16; hand-written SQL migrations for triggers/views | both |
| Frontend | React 19 + Vite 6, TanStack Router + TanStack Query, Tailwind 4 + shadcn/ui | edc |
| Shared contracts | `packages/schemas` (Zod → shared API types) | edc |
| Auth | OIDC SSO (openid-client) + opaque session token stored as sha256 hash, httpOnly cookie; Argon2 local fallback | edc |
| RBAC | grant-based, scoped to study/site; admin ≠ clinical/lab permissions | both |
| Audit | **hash-chained** append-only `audit_event` via `withActor()` + `SECURITY DEFINER` fn; runtime role has no forge path | ctms |
| Immutability | DB triggers reject UPDATE/DELETE on regulated tables; least-privilege `lims_app` role can't run DDL or disable triggers | both |
| Attachments | content-addressed WORM storage (sha256-keyed), pluggable local/S3 (Object Lock) | ctms |
| Analytics | DuckLake (Parquet + DuckDB cataloged in Postgres) + R engine sidecar — **deferred past the slice** | edc |
| Release | CI `lint→typecheck→test→build` on a real Postgres service; tag-driven GHCR images; per-release validation pack | edc |
| Docs | ADR log (`docs/adr/`), requirement→feature traceability matrix, Quarto docs site to Pages | both |

**Convergence choices to record as ADRs** (where edc and ctms differ, pick one for the platform): Fastify over Hono; Zod 4 over Zod 3; hash-chained global `audit_event` (ctms) over per-table append-only (edc) as the shared audit standard, *plus* versioned value rows for regulated result/value edits (edc). These belong in `docs/adr/` so the siblings have a documented target.

---

## Repository layout

Mirror the sibling monorepo shape:

```
apps/web                 React 19 SPA (Vite, TanStack, Tailwind/shadcn)
apps/api                 Fastify 5 API; src/{auth,routes,services,db,scripts}
  api/src/db/schema      Drizzle table defs, split per domain
  api/drizzle            Hand-numbered SQL migrations (0000..) incl. audit/CoC triggers
packages/schemas         Zod contracts + shared API types
packages/core            Domain logic: audited mutations, authz, chain-of-custody, storage allocation
packages/labels          Barcode/label generation (GS1/2D DataMatrix) — shared client+server
services/r-engine        R (plumber) analytics sidecar — scaffold only, deferred
infra/compose.yaml       Postgres 16 + api + web (+ r-engine later)
docs/                    architecture.md, regulatory-traceability.md, adr/
site/                    Astro Starlight docs/demo site → GitHub Pages
CLAUDE.md                house rules + "constraints that will bite you" + LLM-practice rules
```

---

## Platform spine (shared across all three repos)

These are the interop seams the three tools must agree on. Define them in `lims-core` deliberately:

- **Identity:** one OIDC IdP; identity resolves to a `person`/`user` by email claim; no unattributable writes (ctms rule). A single sign-on works across EDC, CTMS, LIMS.
- **Org / Study / Site:** shared `organization → study → site` model, OID-addressed. CTMS is the natural master of this spine; LIMS and EDC reference studies/sites by the same identifiers.
- **Subject / Visit linkage (the key LIMS↔EDC seam):** a specimen is collected from an EDC subject at a study-event (visit). LIMS stores the EDC `subjectKey`/`studyEventOid` *references only* — **no PHI, no subject-level clinical data** (mirrors ctms's enrollment-aggregate rule). Chain of custody begins at collection.
- **Consent propagation:** if a subject withdraws consent in EDC, their specimens in LIMS must be flagged for hold/destruction — a first-class chain-of-custody obligation, not an afterthought.
- **Audit standard:** the hash-chained `audit_event` + `withActor()` pattern becomes the shared audit contract.

---

## Data model

### Domain-neutral core (serves biobank *and* analytical labs)

- **`sample`** — the managed unit (biobank: specimen; analytical: sample). Type, matrix, collection metadata, status (workflow state), source reference. UUID PK, `timestamptz`, OID-addressable.
- **`sample_lineage`** — parent→child derivations (aliquoting, pooling, extraction e.g. blood→DNA). Biobank-critical; also models analytical sub-sampling. Self-referential.
- **`analysis_service`** — a test/analysis definition: a catalog of named tests, each with a code, method, and specification (acceptance criteria). `analysis_profile` bundles services; `method` and `specification` attach to services.
- **`analysis_request`** (order) — a request for tests on a sample; the submission unit. Links sample → services.
- **`result`** — measured value for one analysis on one sample; QC flags; **append-only versioned rows** with `reasonForChange` (edc pattern); verified/signed states.
- **`worksheet`** — batches analyses for an instrument run (deferred detail; stub in slice).
- **`storage_unit`** — hierarchical location: facility → freezer → shelf → rack → box → position, with capacity + temperature. Biobank-critical; also analytical retains.
- **`custody_event`** — immutable chain-of-custody row per sample (collection, receipt, transfer, location change, aliquot, disposal). Append-only.
- **`inventory_item`** / **`lot`** — reagents/consumables, lot numbers, expiry, quantities.
- **`instrument`** — registry + calibration/maintenance schedule (integration deferred).
- **`shipment`** / **`kit`** — collection kits and inbound/outbound shipments with custody handoff.
- **`client`** — external submitter (analytical labs) *or* study/site linkage (biobank).

### Biobank specialization (ship first)
Specimen typing (blood/serum/plasma/tissue/urine/DNA/RNA), collection at an EDC subject visit, aliquot trees, freezer storage with temperature + position, kits & shipments, consent-withdrawal holds.

### Analytical specialization (follow-on module — designed for, not built yet)
Test catalog with specifications + calculations, worksheets & QC samples (blanks/spikes/dups/controls), Certificate of Analysis generation, instrument result capture (ASTM/LIS2-A2, HL7v2), stability studies, environmental monitoring.

### Compliance tables (from day one)
- **`audit_event`** — bigserial, before/after JSONB, `prev_hash`/`hash` (ctms hash-chain); `AFTER` triggers on every domain table; `SECURITY DEFINER` writer; runtime role's INSERT revoked so the app can't forge rows; a `verify_audit_chain()` fn.
- **`signature`** — e-signatures bound to a content hash at signing; immutable-with-invalidation guard trigger; requires fresh re-auth (OIDC `prompt=login` / restated bearer) per §11.200.
- Reuse the exact trigger pattern from `edc-core` `apps/api/drizzle/0001_audit_triggers.sql` (`reject_mutation`, `signature_guard`, current-value view) and the least-privilege-role + `withActor()` pattern from `ctms-core` `packages/db/migrations/0001` + `0004` and `core/src/actor.ts`.

---

## First deliverable: the vertical slice

One workflow, working front-to-back, exercising every architectural pillar:

1. **Auth & RBAC** — log in via OIDC (dev-token mode for local), resolve to a user, grant a lab role scoped to a study/site.
2. **Accession a specimen** — create a `sample` linked to a study/site (+ optional EDC subject/visit reference), pick specimen type; server writes a hash-chained `audit_event` in the same transaction; opens a `custody_event` (collection/receipt).
3. **Label it** — generate a 2D DataMatrix/barcode + human-readable accession ID (`packages/labels`).
4. **Store it** — allocate a freezer `storage_unit` position; record the location as a `custody_event`.
5. **Order a test** — create an `analysis_request` selecting one `analysis_service` on the sample.
6. **Enter & verify a result** — append a versioned `result`; transition workflow (`pending → entered → verified`).
7. **E-sign** — sign the verified result with re-auth; signature bound to content hash; immutable.
8. **Audit trail UI** — view the full hash-chained history for the sample and confirm the chain verifies.

**UI:** a React 19 SPA with a specimen list, an accession form, a storage picker, a result-entry panel, and an audit-trail view — using shadcn/ui so it looks like modern software, not a 2005 LIMS.

### Critical files to create
- `apps/api/src/db/schema/{samples,storage,custody,tests,results,auth,audit}.ts` — Drizzle defs
- `apps/api/drizzle/0000_init.sql`, `0001_audit_triggers.sql`, `0002_least_priv_role.sql`, `0003_seed_roles.sql` — hand-written, porting the sibling trigger/role SQL
- `apps/api/src/auth/{plugin,rbac}.ts` — port from `edc-core`
- `packages/core/src/{actor,audit,custody,storage,results}.ts` — audited mutations
- `packages/schemas/src/*` — Zod contracts for the slice's endpoints
- `apps/api/src/routes/{samples,storage,orders,results,audit}.ts` — thin routes + co-located `*.test.ts`
- `apps/web/src/routes/*` — TanStack Router pages for the slice
- `infra/compose.yaml`, root `package.json`, `biome.json`, `tsconfig.base.json`, `.github/workflows/ci.yml`
- `CLAUDE.md`, `docs/adr/0001..000N`, `docs/regulatory-traceability.md`, `site/`

---

## Roadmap beyond the slice (for context, not this build)

1. Biobank depth: aliquot trees, kits & shipments, consent-withdrawal holds, bulk accessioning, freezer map visualization.
2. Analytical module: test specs + calculations, worksheets, QC, Certificate of Analysis (PDF).
3. Instrument integration: ASTM/LIS2-A2 + HL7v2 inbound results; SiLA2 for automation.
4. Analytics: DuckLake + R engine for QC trending, turnaround-time dashboards, stability.
5. Cross-system: live EDC subject/visit linkage, CTMS study/site sync, shared SSO.

---

## LLM-practice & docs discipline (carry over from siblings)

- **`CLAUDE.md`** with the siblings' hard rule: **never write regulatory specifics (21 CFR Part 11, GxP, ISBER, CAP/CLIA, ISO 17025) from model memory** — ground every claim against authoritative source text and cite the section, or flag it in the PR. Add a "constraints that will bite you" section (least-privilege role, immutable rows mean tests can't self-clean, e-sign needs re-auth).
- **ADR log** for every non-obvious decision, including the convergence choices (Fastify, Zod 4, hash-chained audit) so the siblings have a documented target.
- **Requirement→feature traceability matrix** with IDs threaded inline in schema comments (`P11-xx`, `CoC-xx`).
- Prompt the user to log the biobank-vs-analytical shared-core decision and the platform-spine seams as ADRs during implementation.

---

## Verification

- **Local run:** `pnpm install && podman compose -f infra/compose.yaml up --build` brings up Postgres 16 + api + web. Bootstrap an admin + seed a demo study/site and one specimen type via `pnpm --filter @lims-core/api db:seed-demo`.
- **Drive the slice end-to-end** (the `/verify` skill / browser MCP): accession a specimen → label → store → order → result → verify → sign → view audit trail, confirming each step in the UI and that `verify_audit_chain()` passes.
- **Automated tests (Vitest, co-located):** unit + route tests for each endpoint; **compliance tests that assert the guarantees**, per the siblings — direct `UPDATE`/`DELETE` on `audit_event`/`result` version rows/`signature` must fail; the app role cannot forge an `audit_event`; a tampered chain fails `verify_audit_chain()`.
- **CI gate:** `pnpm check` = `lint && typecheck && test` green against a real `postgres:16` service in GitHub Actions; web build passes.
- **Traceability:** each compliance test references its requirement ID; the validation-pack generator joins the matrix to test results.
```
