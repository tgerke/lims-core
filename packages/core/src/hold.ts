import { sampleLineage, samples } from "@lims-core/db";
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "./actor.js";
import { recordCustodyEvent } from "./custody.js";
import { DomainError } from "./errors.js";

// A hold acts on samples that are physically under this lab's control. In-transit
// samples are with a carrier and disposed ones are gone; both are skipped.
const HOLDABLE = new Set(["registered", "in_storage", "in_testing", "depleted"]);

export interface HoldTarget {
  studyId: string;
  /** Exactly one of sampleId / subjectKey identifies the base set. */
  sampleId?: string;
  subjectKey?: string;
  reason: string;
  actorId: string;
}

export interface DisposeTarget extends HoldTarget {
  method?: string;
}

/** All samples reachable as lineage descendants of the roots, roots included. */
async function withDescendants(tx: Tx, rootIds: string[]): Promise<string[]> {
  const all = new Set(rootIds);
  let frontier = rootIds;
  while (frontier.length > 0) {
    const rows = await tx
      .select({ childId: sampleLineage.childId })
      .from(sampleLineage)
      .where(inArray(sampleLineage.parentId, frontier));
    const next: string[] = [];
    for (const { childId } of rows) {
      if (!all.has(childId)) {
        all.add(childId);
        next.push(childId);
      }
    }
    frontier = next;
  }
  return [...all];
}

/**
 * Resolves the base set from either a single sample or a subject key (all of
 * that subject's samples — the consent-withdrawal case), then expands to include
 * every lineage descendant so aliquots and derivatives are caught with the parent.
 */
async function resolveTargets(tx: Tx, t: HoldTarget) {
  if ((t.sampleId ? 1 : 0) + (t.subjectKey ? 1 : 0) !== 1) {
    throw new DomainError("provide exactly one of sampleId or subjectKey");
  }
  let roots: string[];
  if (t.sampleId) {
    const [s] = await tx.select().from(samples).where(eq(samples.id, t.sampleId)).limit(1);
    if (!s) throw new DomainError("sample not found", 404);
    if (s.studyId !== t.studyId) throw new DomainError("sample is not in this study", 400);
    roots = [s.id];
  } else {
    const rows = await tx
      .select({ id: samples.id })
      .from(samples)
      .where(and(eq(samples.studyId, t.studyId), eq(samples.subjectKey, t.subjectKey as string)));
    if (rows.length === 0) throw new DomainError("no samples for that subject", 404);
    roots = rows.map((r) => r.id);
  }
  const ids = await withDescendants(tx, roots);
  return tx.select().from(samples).where(inArray(samples.id, ids));
}

/**
 * Places a hold on a sample (or a whole subject's samples) and their lineage
 * descendants (CoC-05). Each affected sample moves to on_hold — which blocks
 * aliquoting, storage moves, and shipment — with its prior status remembered for
 * release, and a `hold` custody event records the reason. Already-held, disposed,
 * and in-transit samples are skipped. Runs inside withActor.
 */
export async function placeHold(tx: Tx, input: HoldTarget) {
  const scope = input.sampleId ? "sample" : "subject";
  const targets = (await resolveTargets(tx, input)).filter((s) => HOLDABLE.has(s.status));
  if (targets.length === 0) {
    throw new DomainError("nothing to hold: no eligible samples in scope", 409);
  }

  const held = [];
  for (const s of targets) {
    const [updated] = await tx
      .update(samples)
      .set({ status: "on_hold", preHoldStatus: s.status, updatedAt: new Date() })
      .where(eq(samples.id, s.id))
      .returning();
    if (!updated) throw new Error("hold update returned no row");
    await recordCustodyEvent(tx, {
      sampleId: s.id,
      studyId: input.studyId,
      eventType: "hold",
      actorId: input.actorId,
      details: { reason: input.reason, scope, priorStatus: s.status },
    });
    held.push(updated);
  }
  return held;
}

/**
 * Lifts a hold on a sample or subject and their descendants (CoC-05). Each
 * currently-held sample returns to the status it had before the hold (a stored
 * sample to in_storage, a bare one to registered), and a `hold_release` custody
 * event records the reason. Non-held samples in scope are left alone.
 */
export async function releaseHold(tx: Tx, input: HoldTarget) {
  const targets = (await resolveTargets(tx, input)).filter((s) => s.status === "on_hold");
  if (targets.length === 0) {
    throw new DomainError("nothing to release: no held samples in scope", 409);
  }

  const released = [];
  for (const s of targets) {
    const restored = s.preHoldStatus ?? "registered";
    const [updated] = await tx
      .update(samples)
      .set({ status: restored, preHoldStatus: null, updatedAt: new Date() })
      .where(eq(samples.id, s.id))
      .returning();
    if (!updated) throw new Error("hold release update returned no row");
    await recordCustodyEvent(tx, {
      sampleId: s.id,
      studyId: input.studyId,
      eventType: "hold_release",
      actorId: input.actorId,
      details: { reason: input.reason, restoredStatus: restored },
    });
    released.push(updated);
  }
  return released;
}

/**
 * Disposes a sample or subject and their descendants (CoC-05). Each non-disposed
 * sample in scope becomes disposed (terminal — no further aliquot, storage, or
 * shipment), frees its storage position, and a `disposal` custody event records
 * the reason and method. Disposal is allowed from any live status; the reserved
 * hold->dispose consent-withdrawal path is the common one but not required.
 */
export async function disposeSamples(tx: Tx, input: DisposeTarget) {
  const scope = input.sampleId ? "sample" : "subject";
  const targets = (await resolveTargets(tx, input)).filter((s) => s.status !== "disposed");
  if (targets.length === 0) {
    throw new DomainError("nothing to dispose: all samples in scope already disposed", 409);
  }

  const disposed = [];
  for (const s of targets) {
    const [updated] = await tx
      .update(samples)
      .set({
        status: "disposed",
        preHoldStatus: null,
        storageUnitId: null,
        storagePosition: null,
        updatedAt: new Date(),
      })
      .where(eq(samples.id, s.id))
      .returning();
    if (!updated) throw new Error("disposal update returned no row");
    await recordCustodyEvent(tx, {
      sampleId: s.id,
      studyId: input.studyId,
      eventType: "disposal",
      actorId: input.actorId,
      details: {
        reason: input.reason,
        scope,
        priorStatus: s.status,
        ...(input.method ? { method: input.method } : {}),
      },
    });
    disposed.push(updated);
  }
  return disposed;
}
