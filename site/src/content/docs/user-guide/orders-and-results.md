---
title: Orders and results
description: Versioned, append-only results with four-eyes verification and an automatic QC verdict.
---

With a specimen stored, you can order a test against it and record the result.
Results are the most tightly controlled records in the system: they are
versioned, append-only, and cannot be released by the same person who entered
them.

## Ordering a test

Each study draws from a catalog of analysis services — a named test with a code
and a unit (the demo study seeds Prostate-Specific Antigen in ng/mL, Total
Testosterone in ng/dL, and ctDNA Yield in ng). Ordering one creates an analysis
request against the specimen. The catalog is the same structure an analytical
lab uses for its full test menu; here it carries the handful of tests the
biobank workflow needs.

## Entering a result

Enter a value and its unit against an order. The result starts as an unverified
version. If a result needs correcting, you do not overwrite it: entering a new
value **adds a version**, and the server requires a reason for the change. The
original value stays visible in the result's history forever (requirement
P11-02).

:::note
"Append-only and versioned" is the whole point. A regulated result's prior
value is never lost, and every change carries a stated reason and an
attributed author. The result panel shows each version with its value, status,
who entered it, and the reason.
:::

![A sample's tests and results: versioned entries, four-eyes verification, and a QC verdict per result.](../../../assets/screenshots/04-sample-detail.png)

## Specifications and QC status

A service can carry an **acceptance criterion** — a numeric range or a
qualitative expectation — versioned by supersession. When a result is entered,
the system evaluates it against the active specification and stamps a QC verdict
on the result: `pass`, `out_of_spec`, or `not_evaluated` (ADR-0017). The verdict
is visible in the result panel next to the value, so an out-of-range result is
obvious at entry rather than at release.

Some services are **calculated** rather than typed in: their value comes from a
safe expression over other results on the same sample, evaluated server-side
(ADR-0020). A calculated result is versioned and verified like any other.

## Four-eyes verification

A result follows a **four-eyes rule**: the person who enters a result cannot
verify their own work. A lab manager reviews it and verifies, and the verifier
must be a different user than the enterer — the system rejects a self-verify.
Verification is what promotes a result toward release.

Only a verified result can be released, and releasing it requires an
[electronic signature](/lims-core/user-guide/signatures/). Where results are produced in batches on
an instrument run, the [analytical testing](/lims-core/user-guide/analytical-testing/) page covers
worksheets and the run-level QC gate that can hold a whole run's results back.
