# ADR-0022: Certificate of Analysis (PDF)

Status: accepted (2026-07-11)

## Context

The analytical module (specs, worksheets, QC, calculated results) produces
released results but has no way to issue the document a lab hands back: a
Certificate of Analysis. This slice adds it — the capstone that consumes results
(ADR-0017), their spec verdicts, calculated values (ADR-0020), and QC
(ADR-0019/0021) into an issued, immutable, renderable document.

## Decision

- **A CoA is an immutable snapshot, not a live view.** `issueCertificate`
  gathers the sample's currently *released* results (verified or signed — never a
  draft entry), freezes them into a `snapshot` JSONB (study, sample, analytes
  with value/unit/QC/source, issuer, timestamp), and stores it with a
  per-study `coa_number` (`STUDY-001-COA-00001`, like shipment/worksheet
  counters). `certificate_of_analysis` is append-only (rejects UPDATE/DELETE like
  `result`/`signature`); a correction is a newly issued CoA, so a certificate can
  never be silently altered after it leaves the lab.
- **The PDF is rendered on demand from the snapshot, bound by a hash.**
  `content_hash` is the sha256 of a canonically serialized snapshot (sorted keys,
  deterministic), mirroring the e-signature record hash (P11-09). `renderCoaPdf`
  (pdf-lib, no native deps) draws the stored snapshot, and the hash is printed on
  the document, so a rendered PDF can be proven to match exactly what was
  certified without storing the binary.
- **Content is strictly factual.** The PDF asserts identifiers, analytes,
  verdicts, issuer, and the integrity hash — and deliberately makes no
  regulatory, accreditation, or compliance claim, per the project hard rule
  (never state regulatory specifics not grounded in source). Any such statement
  is a human decision to add against cited requirements, not model boilerplate.
- **Issuing reuses `result.sign`.** Issuing a CoA is a senior release act, so it
  is authorized by the same authority already trusted to release results by
  e-signature (lab_admin, lab_manager). It does not itself apply an e-signature,
  so it does not re-authenticate; no new permission is introduced.

## Consequences

The analytical module can now issue the document that closes the workflow, with
every certificate an immutable, hash-bound snapshot rendered deterministically to
PDF. Because the snapshot is stored and hashed rather than the PDF, the record
stays small and the rendering can evolve (layout, branding) without invalidating
historical certificates — the hash covers the certified data, not its pixels.

Deferred (named so the gap stays explicit): applying an e-signature to the CoA
itself (today issuance is authority-gated but not itself signed); CoA templates
and lab letterhead/branding; multi-sample or batch certificates; revocation/
supersession linkage between a corrected CoA and the one it replaces; and any
regulated content blocks (accreditation numbers, method references), which must
be authored against cited sources by a human.
