# ADR-0001: Adopt edc-core's toolchain as the convergent platform stack

Status: accepted (2026-07-10)

## Context

`lims-core` is the third sibling to `edc-core` (EDC) and `ctms-core` (CTMS)
under one long-term platform. The three should converge onto a single
interoperable stack so a shared identity, study/site spine, and audit contract
work across all of them. The siblings diverge today: `edc-core` is the newest
and most complete (pnpm + Biome + strict tsconfig, Fastify 5, Zod 4, React 19,
CI against a real Postgres). `ctms-core` lags (Hono, Zod 3, React 18, no
lint/CI) but carries the stronger compliance machinery (hash-chained audit,
least-privilege role, `withActor`).

## Decision

Adopt `edc-core`'s toolchain wholesale as the platform standard and fold in
`ctms-core`'s compliance machinery:

- Monorepo: pnpm 11 workspaces, Node ≥22, TypeScript 5.6 ESM, one strict
  `tsconfig.base`.
- Lint/format: Biome 2.x.
- Backend: Fastify 5 + Zod 4, thin routes / fat services.
- DB: PostgreSQL 16, Drizzle for table defs + queries, **hand-written SQL
  migrations** for triggers/views/roles (drizzle-kit can't express them).
- Frontend: React 19 + Vite 6, TanStack Router + Query, Tailwind 4.
- Compliance (from ctms): hash-chained `audit_event` written by a
  `SECURITY DEFINER` trigger via `withActor()`; a DML-only runtime role with
  no forge path; DB triggers reject UPDATE/DELETE on regulated tables.

This ADR does not refactor the siblings; it establishes the target they can
migrate toward.

## Consequences

New code matches `edc-core` idioms, so reviewers move between repos without
retooling. `ctms-core` should migrate off Hono/Zod 3/React 18 over time. The
hand-written-migration split means schema changes touch two places (the SQL
and the Drizzle table def) and must be kept in sync — the price of triggers
the ORM can't model.
