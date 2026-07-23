# ADR-0025: The docs/demo site moves from Quarto to Astro Starlight

Status: accepted (2026-07-23)

## Context

lims-core shipped a Quarto site in `docs-site/` (an overview, getting-started,
compliance, roadmap, glossary, and a 13-page user guide), published to GitHub
Pages. The sibling repos have since rebuilt their docs on Astro Starlight —
edc-core in `site/`, and ctms-core (ctms-core ADR-0033) — so their public docs
read like the commercial systems the roadmaps benchmark against (Medidata,
Veeva, Florence). lims-core was the only one of the three still on Quarto, and
the docs are part of how the project is evaluated, by both technical users and
CRO/pharma decision-makers. This slice brings it onto the same footing.

## Decision

- **Rebuild the site as an Astro Starlight project in `site/`**, a pnpm
  workspace member, replacing `docs-site/`. Pages convert from `.qmd` to
  Markdown/MDX with every slug preserved; Quarto callouts become Starlight
  asides; the flat user guide is regrouped into a lifecycle sidebar (biobank
  workflow, analytical and QC, inventory and reporting, compliance and
  security). The scaffold copies edc-core/ctms-core deps and structure so the
  three sites stay recognizable as one stack.
- **A per-product palette, mapped from the app chrome.** `custom.css` overrides
  Starlight's theme variables with lims-core's slate neutrals and an indigo
  accent (from `apps/web/src/index.css`), the same technique the siblings use
  (edc = zinc/blue, ctms = warm paper/info-blue). The shared design system plus
  a distinct palette keeps the trio coherent without making them identical.
- **Add an executive-facing landing and a differentiators page.** A splash
  `index.mdx` (hero, feature grid, a "Start here by seat" block routing
  leadership and auditors alongside lab and data roles) and `why-lims-core.md`.
  Both keep the project's honest positioning — a working build on a
  production-shaped compliance core, not a validated system and not a drop-in
  replacement — and per the project hard rule they introduce no new regulatory
  specifics: every compliance claim reuses language already grounded in
  `compliance.md` and `docs/regulatory-traceability.md`.
- **Screenshots come only from a script.** The 15 app screenshots move into the
  Astro asset pipeline (`site/src/assets/screenshots/`, optimized at build by
  sharp), and `scripts/screenshots.mjs` (Playwright, `pnpm screenshots`)
  regenerates them from the seeded dev stack — adapted from edc-core's
  generator. Reaching the e-signature dialog needs a verified, not-yet-signed
  order, so the script sets that state up itself (enter a result as a
  technician, verify it as a manager) before capturing.
- **Code examples stay static and old URLs keep working.** Fenced code is
  displayed, never executed, so the Pages build needs only Node and pnpm, no
  database. Meta-refresh stubs in `site/public/` redirect the Quarto-era
  `.html` URLs one-to-one to the new trailing-slash paths.

## Consequences

- `.github/workflows/docs.yml` switches from `quarto render` to
  `pnpm --filter site build`; `site/dist/` is gitignored and CI builds it fresh
  per deploy. The Pages target is unchanged (`https://tgerke.github.io/lims-core`).
- `starlight-links-validator` fails the build on any broken internal link, so a
  bad cross-reference is caught at build time rather than shipped.
- The user guide continues to live only on the site (not in `docs/`, which holds
  the plan, ADRs, and traceability matrix). `README.md` now embeds the hero
  screenshot from its new `site/` path.
- Deferred, matching the siblings: no client-side Mermaid diagram was added
  (lims-core's data model isn't yet drawn on the site); a data-model page can
  adopt the siblings' `Mermaid.astro` component when it's worth adding.
