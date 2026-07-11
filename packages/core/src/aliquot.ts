import { sampleLineage, samples } from "@lims-core/db";
import { formatAliquotId } from "@lims-core/labels";
import { and, eq } from "drizzle-orm";
import type { Tx } from "./actor.js";
import { recordCustodyEvent } from "./custody.js";
import { DomainError } from "./errors.js";

export interface AliquotInput {
  parentId: string;
  count: number;
  /** Per-child amount; required when the parent has a tracked quantity. */
  volume?: number;
  actorId: string;
}

/**
 * Splits a parent sample into `count` child aliquots (CoC-04). Each child is a
 * new sample with a parent-suffixed accession id, linked by a `sample_lineage`
 * row and opened with an `aliquot` custody event. When the parent has a tracked
 * quantity, `volume` is deducted from it (conserved across parent + children)
 * and the parent is marked `depleted` at zero. Runs inside withActor so the
 * audit chain attributes every row.
 */
export async function aliquotSample(tx: Tx, input: AliquotInput) {
  const [parent] = await tx.select().from(samples).where(eq(samples.id, input.parentId)).limit(1);
  if (!parent) throw new DomainError("sample not found", 404);
  if (parent.status === "disposed" || parent.status === "depleted" || parent.status === "on_hold") {
    throw new DomainError(`sample is ${parent.status} and cannot be aliquoted`, 409);
  }

  const tracked = parent.quantity !== null;
  let newParentQuantity: number | null = null;
  if (tracked) {
    if (input.volume === undefined) {
      throw new DomainError("this sample tracks quantity, so each aliquot needs a volume");
    }
    const available = Number(parent.quantity);
    const drawn = input.count * input.volume;
    if (drawn > available) {
      const unit = parent.quantityUnit ? ` ${parent.quantityUnit}` : "";
      throw new DomainError(
        `aliquots draw ${drawn}${unit} but only ${available}${unit} remain`,
        409,
      );
    }
    newParentQuantity = available - drawn;
  }

  // Continue the ordinal sequence across repeat aliquot operations.
  const existing = await tx
    .select({ childId: sampleLineage.childId })
    .from(sampleLineage)
    .where(and(eq(sampleLineage.parentId, parent.id), eq(sampleLineage.relation, "aliquot")));
  const startOrdinal = existing.length + 1;

  const children = [];
  for (let i = 0; i < input.count; i++) {
    const ordinal = startOrdinal + i;
    const [child] = await tx
      .insert(samples)
      .values({
        studyId: parent.studyId,
        siteId: parent.siteId,
        accessionId: formatAliquotId(parent.accessionId, ordinal),
        sampleType: parent.sampleType,
        subjectKey: parent.subjectKey,
        studyEventOid: parent.studyEventOid,
        collectedAt: parent.collectedAt,
        receivedAt: parent.receivedAt,
        quantity: tracked ? String(input.volume) : null,
        quantityUnit: parent.quantityUnit,
        initialQuantity: tracked ? String(input.volume) : null,
        createdBy: input.actorId,
      })
      .returning();
    if (!child) throw new Error("aliquot child insert returned no row");

    await tx
      .insert(sampleLineage)
      .values({ parentId: parent.id, childId: child.id, relation: "aliquot" });

    await recordCustodyEvent(tx, {
      sampleId: child.id,
      studyId: parent.studyId,
      eventType: "aliquot",
      actorId: input.actorId,
      details: { parentId: parent.id, parentAccessionId: parent.accessionId },
    });
    children.push(child);
  }

  let updatedParent = parent;
  if (tracked) {
    const [updated] = await tx
      .update(samples)
      .set({
        quantity: String(newParentQuantity),
        status: newParentQuantity === 0 ? "depleted" : parent.status,
        updatedAt: new Date(),
      })
      .where(eq(samples.id, parent.id))
      .returning();
    if (!updated) throw new Error("parent quantity update returned no row");
    updatedParent = updated;
  }

  await recordCustodyEvent(tx, {
    sampleId: parent.id,
    studyId: parent.studyId,
    eventType: "aliquot",
    actorId: input.actorId,
    details: {
      childIds: children.map((c) => c.id),
      count: input.count,
      ...(tracked ? { volumeEach: input.volume, quantityUnit: parent.quantityUnit } : {}),
    },
  });

  return { parent: updatedParent, children };
}
