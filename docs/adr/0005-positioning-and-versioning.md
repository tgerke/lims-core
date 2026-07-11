# ADR-0005: Public positioning and pre-1.0 versioning at the vertical-slice milestone

Status: accepted (2026-07-10)

## Context

The first public release ships a single end-to-end workflow
(accession → store → order → result → verify → sign → audit) on a
production-shaped compliance core, but only a fraction of the functional
surface a CRO or pharma sponsor expects from a LIMS (see
[completeness-review.md](../completeness-review.md)). The established commercial
LIMS platforms are large and configurable; lims-core is not near parity.

Two framings are tempting and both are wrong for this stage. Overselling — "an
open replacement for a commercial LIMS" — sets an expectation the software
cannot meet and, in a regulated-software market, reads as a compliance
liability rather than a feature. Underselling — hiding the milestone or not
tagging a release — throws away the credibility the compliance core has actually
earned.

A related question is how to refer to the incumbents at all. Earlier drafts of
the public docs named specific commercial products by brand. For an
open-source project positioning against a category, naming competitors adds
nothing the category description doesn't, dates the docs, and invites needless
comparison disputes. And the demo data raised the same vendor-neutrality
concern from the other side: the project was originally seeded with a specific
organization's study and site.

## Decision

**Version pre-1.0 and describe the project honestly, in public, at the
milestone it has actually reached.**

- First tag is **`v0.1.0`**, labeled "vertical slice." 1.0 is reserved for a
  release that can run a regulated trial biobank end to end (roughly Tier 1 of
  the completeness review complete), not for the first working demo.
- The README, the GitHub Pages guide, and the release notes state plainly that
  lims-core is **not yet a production biobank system and not a drop-in
  replacement for a commercial LIMS**, and link to the completeness review for
  the gap analysis. The sanctioned pitch is "an open, modern nucleus you can
  grow into an alternative to those platforms," never "a replacement you can
  install next quarter."
- **Positioning names the product category, never specific competitor
  products.** Public-facing docs say "commercial LIMS platforms," "an
  established commercial LIMS," or similar; they do not print vendor brand
  names. Internal notes may reference a product where it genuinely aids a
  technical comparison, but the shipped docs stay brand-neutral.
- Demo data and code examples use **generic, org-neutral identifiers**
  (`DEMO-001`, `SITE-01`, `STUDY-001`). No specific institution, sponsor, or
  vendor appears as the project's owner or customer.

## Consequences

Marketing copy stays boring and true, which is the correct trade for regulated
software: nobody is misled into a validation or migration effort the tool can't
support yet, and the honest gap analysis doubles as the roadmap. The cost is
that the public framing understates ambition — a reader skimming for a named
"[incumbent] replacement" will bounce. That is acceptable; the intended audience
is people who value the compliance substrate and want to build on it.

Version numbers now carry meaning: staying pre-1.0 signals "foundation, not
product." When the Tier 1 roadmap lands, promoting to 1.0 is a deliberate,
documented event, and this ADR is the reference for what 1.0 has to clear —
superseded at that point, not patched.
