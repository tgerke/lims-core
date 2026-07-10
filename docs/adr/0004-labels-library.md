# ADR-0004: bwip-js + DataMatrix for specimen labels

Status: accepted (2026-07-10)

## Context

`packages/labels` is the one nontrivial from-scratch component in the first
slice — neither sibling has a barcode/label generator. A specimen label needs
a machine-readable 2D symbol plus a human-readable accession ID, printable
onto tiny cryovial labels.

## Decision

- **Symbology: DataMatrix**, not QR. DataMatrix is the healthcare/lab
  convention (GS1 healthcare specifies it), tolerates very small label real
  estate, and is what most lab scanners expect.
- **Library: `bwip-js`** (BSD-licensed, pure JS, no native deps, renders to a
  PNG Buffer server-side). It supports GS1 DataMatrix and the many other
  symbologies a later analytical module may need, so we don't re-pick.
- Accession-ID formatting (`formatAccessionId`) lives in the package's
  isomorphic entry so client and server agree; the `bwip-js` renderer is a
  separate `./datamatrix` export so the web bundle only pulls it in if it
  renders labels itself (today the API renders `label.png`).

## Consequences

One dependency, license-clean, covers future symbology needs. The API owns
label rendering for now; moving it client-side later is a matter of importing
the `./datamatrix` export in the SPA. GS1 application-identifier encoding
(e.g. embedding study/subject in a structured GS1 string) is deferred — the
current label encodes the accession ID as plain text.
