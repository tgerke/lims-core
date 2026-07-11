# Regulatory traceability matrix

Requirement IDs are threaded inline in schema column comments
(`packages/db/migrations/0000_init.sql`) and referenced by the compliance
tests that assert each guarantee. This table joins requirement → where it is
enforced → the test that proves it. Do not edit regulatory wording from model
memory (see `CLAUDE.md`); every claim here traces to enforced behavior in the
repo, not to a paraphrase of the regulation.

## 21 CFR Part 11 (electronic records & signatures)

| ID | Requirement (plain language) | Enforced by | Proven by |
| --- | --- | --- | --- |
| P11-01 | Audit trail cannot be altered or fabricated | `audit_event` append-only trigger; runtime role's INSERT revoked; `SECURITY DEFINER` writer (`0001`, `0002`) | `db/compliance.test.ts` → "append-only enforcement", "audit forgery paths" |
| P11-02 | Record changes append; prior values stay visible (§11.10(e)) | `result` versioned rows + append-only trigger; `reasonForChange` required on correction (`enterResult`) | `db/compliance.test.ts`; `routes/slice.test.ts` → "requires a reason for change" |
| P11-03 | Retroactive edits are detectable | Hash chain + `lims_verify_audit_chain()` (`0001`, ADR-0002) | `db/compliance.test.ts` → "detects a tampered event"; `slice.test.ts` → audit verify |
| P11-04 | Access is authority-checked; admin ≠ clinical/lab authority | Grant-based RBAC scoped to study/site; `hasPermission`; system admins hold no lab permissions | `routes/slice.test.ts` → "blocks result entry without result.enter", audit-review denial |
| P11-05 | Audit trail is reviewable | `/studies/:id/audit` filterable feed + facets | `routes/slice.test.ts` → "reviewable, verifying audit trail" |
| P11-06 | Signatures state their meaning (§11.50) | `signature.meaning`, displayed in the sign dialog and recorded | `routes/slice.test.ts` → sign |
| P11-07 | Failed-auth lockout (§11.300(d)) | `failedLoginCount`/`lockedUntil`; login and signature re-auth both count | `auth/service.ts` (exercised via login/sign paths) |
| P11-08 | Session tokens not stored in the clear | sha256 `token_hash`; raw token never persisted | `auth/service.ts` |
| P11-09 | Signature bound to the signed record (§11.70) | `signature.record_hash` = sha256 of the signed result version | `routes/slice.test.ts` → "binds to the record hash" |
| P11-10 | Signatures cannot be excised or transferred (§11.70) | `signature` guard trigger: DELETE and field edits rejected; only one-way invalidation | `db/compliance.test.ts` → "signature immutability" |
| P11-12 | Re-authentication at signing (§11.200(a)) | Password step-up (`reauthenticate`) before every signature (ADR-0003) | `routes/slice.test.ts` → "rejects an e-signature with a wrong password" |

## Chain of custody

| ID | Requirement | Enforced by | Proven by |
| --- | --- | --- | --- |
| CoC-01 | Custody begins at collection/receipt | `accessionSample` opens collection + receipt events | `routes/slice.test.ts` → "custody opened" |
| CoC-02 | Custody records are immutable | `custody_event` append-only trigger | `db/compliance.test.ts` → "rejects UPDATE and DELETE on custody_event" |
| CoC-03 | Location changes are recorded; one occupant per position | `storeSample` + `storage_add` event; partial unique index on `(storage_unit_id, storage_position)` | `routes/slice.test.ts` → "stores… with a custody event", "rejects a double-booked position" |
| CoC-04 | Aliquoting preserves an auditable parent→child lineage and conserves quantity | `aliquotSample`: `sample_lineage` rows + `aliquot` custody events on parent and children; volume deducted and conserved (ADR-0006); quantity changes captured by the `sample` audit trigger | `routes/aliquot.test.ts` → "conserving quantity and lineage", over-draw/depletion cases |
| CoC-05 | Consent-withdrawal / quarantine holds move affected samples and their lineage out of use with an auditable reason; disposal is terminal and attributed | `placeHold`/`releaseHold`/`disposeSamples`: subject+lineage propagation, `hold`/`hold_release`/`disposal` custody events carrying the reason, `on_hold` rejected by store/aliquot/shipment guards, `pre_hold_status` restores state on release (ADR-0009); `sample.hold` vs `sample.dispose` split | `routes/hold.test.ts` → "holds a whole subject, blocks use, and releases", "propagates a hold to lineage descendants", "disposes as a terminal, supervisor-only step" |
| CoC-06 | A sample in transit keeps an unbroken custody record from origin to destination | `shipShipment`/`receiveShipment` record a `transfer` custody event per phase; `send`/`receive` split by RBAC (ADR-0007) | `routes/shipment.test.ts` → "moving custody unbroken", separation-of-duties and transition-guard cases |

## Deferred (states reserved, logic not built)

Collection kits, the analytical module (specs/QC/CoA), and instrument
integration are out of scope for this slice. The regulated tables reserve the
enum values they will need so no future migration edits an append-only table
(see ADR-0002 rationale). Aliquoting (CoC-04), shipment custody handoff (CoC-06),
and consent-withdrawal holds (CoC-05) are now built; deeper lineage cases —
pooling and derivation (e.g. blood → DNA) — reuse `sample_lineage` but remain
roadmap. A hold does not yet block result entry on an in-progress order, and
there is no automated EDC-driven hold propagation (a coordinator places it).
