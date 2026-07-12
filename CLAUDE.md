# lims-core — house rules

`lims-core` is a greenfield, AGPL-3.0 open-source Laboratory Information
Management System for clinical-trial biobanking (and, by design, analytical
labs later). It is the third sibling to `edc-core` and `ctms-core`; the three
are converging onto one platform. See `docs/plan.md` for the full design and
`docs/adr/` for the decisions.

## The one hard rule

**Never write regulatory specifics from model memory.** 21 CFR Part 11, GxP,
ISBER, CAP/CLIA, ISO 17025 — ground every claim against authoritative source
text and cite the section, or flag it in the PR for a human to verify. A
plausible-sounding paraphrase of a regulation is a liability, not a feature.
Requirement IDs (`P11-xx`, `CoC-xx`) live in schema column comments and
`docs/regulatory-traceability.md`; keep them tied to enforced behavior, never
to prose invented here.

## Constraints that will bite you

- **The runtime role is DML-only (`lims_app`).** It cannot run DDL, disable
  triggers, or INSERT into `audit_event`. If code needs to create a table or
  bypass a trigger, it is doing something wrong — fix the design, don't
  escalate the role. Migrations run as the owner (`DATABASE_URL`); the server
  connects as `lims_app` (`APP_DATABASE_URL`).
- **Regulated rows are append-only, so tests can't self-clean.** `audit_event`,
  `custody_event`, `result`, and `signature` reject UPDATE/DELETE by trigger.
  Test fixtures use unique suffixes (`test-helpers.ts`) instead of teardown.
- **E-signature needs re-auth.** Every signature re-verifies the signer's
  password (ADR-0003). An OIDC-only account with no local password cannot sign.
- **Every audited write goes through `withActor`.** The audit trigger reads
  the actor from per-transaction settings; a write outside `withActor`
  attributes to `system`. Never insert into a domain table on a bare
  connection expecting attribution.
- **Schema lives in two places.** Hand-written SQL migrations own triggers,
  views, and roles; Drizzle table defs (`packages/db/src/schema`) mirror the
  columns for the query layer. Change both, keep them in sync.
- **Audit chains are per-study (ADR-0002).** The scope comes from the row's
  `study_id`; `custody_event` denormalizes it for that reason. Don't drop that
  column.

## Workflow

- Small fixes: just do them. Nontrivial work: short plan first.
- Commit completed units of work with clear messages. Never push unless asked.
- Match the conventions of the surrounding code. Comment only what the code
  can't say (constraints, gotchas), not narration.

## Local development

```
podman compose -f infra/compose.yaml up -d postgres   # Postgres 16 on :5434
pnpm install
pnpm --filter @lims-core/db db:migrate
pnpm --filter @lims-core/api db:seed-demo               # demo study + users
pnpm dev                                                # api :3001, web :5174
```

`pnpm check` = lint + typecheck + test. The compliance tests need a real
Postgres (they connect as both the owner and `lims_app`). The suite runs
against a dedicated `lims_test` database, not the dev `lims` one — the test
setup (`apps/api/vitest.config.ts` + `src/test-global-setup.ts`) creates and
migrates it automatically, so a test run never leaves cruft in your dev data.
Regulated rows are append-only and can't be torn down, so this isolation is how
the dev DB stays clean. Override the target with `TEST_DATABASE_URL`.
