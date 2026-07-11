import { accessionCounters, sampleLineage, samples } from "@lims-core/db";
import { formatAccessionId } from "@lims-core/labels";
import { eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "./actor.js";
import { recordCustodyEvent } from "./custody.js";
import { DomainError } from "./errors.js";

// Derivation (one parent -> a new material type, e.g. blood -> DNA) and pooling
// (many parents -> one pooled specimen). Both reuse sample_lineage and, unlike
// aliquoting, produce a distinct specimen with its own top-level accession
// number (ADR-0014). A gone or held specimen cannot be a source.
const UNUSABLE = new Set(["disposed", "on_hold", "depleted"]);

async function nextAccessionId(tx: Tx, studyId: string, studyOid: string): Promise<string> {
  const [counter] = await tx
    .insert(accessionCounters)
    .values({ studyId, lastValue: 1 })
    .onConflictDoUpdate({
      target: accessionCounters.studyId,
      set: { lastValue: sql`${accessionCounters.lastValue} + 1` },
    })
    .returning({ lastValue: accessionCounters.lastValue });
  if (!counter) throw new Error("accession counter returned no row");
  return formatAccessionId(studyOid, counter.lastValue);
}

export interface DeriveInput {
  parentId: string;
  studyOid: string;
  derivedType: string;
  quantity?: number;
  quantityUnit?: string;
  actorId: string;
}

/**
 * Derives a new specimen of a different material type from one parent (ADR-0014):
 * a `derivation` lineage row plus a `derivation` custody event on both. The child
 * gets its own accession number (it is a distinct specimen, not an aliquot).
 */
export async function deriveSample(tx: Tx, input: DeriveInput) {
  const [parent] = await tx.select().from(samples).where(eq(samples.id, input.parentId)).limit(1);
  if (!parent) throw new DomainError("sample not found", 404);
  if (UNUSABLE.has(parent.status)) {
    throw new DomainError(`sample is ${parent.status} and cannot be derived from`, 409);
  }

  const now = new Date();
  const accessionId = await nextAccessionId(tx, parent.studyId, input.studyOid);
  const [child] = await tx
    .insert(samples)
    .values({
      studyId: parent.studyId,
      siteId: parent.siteId,
      accessionId,
      sampleType: input.derivedType,
      subjectKey: parent.subjectKey,
      studyEventOid: parent.studyEventOid,
      collectedAt: parent.collectedAt,
      receivedAt: now,
      quantity: input.quantity !== undefined ? String(input.quantity) : null,
      quantityUnit: input.quantityUnit ?? null,
      initialQuantity: input.quantity !== undefined ? String(input.quantity) : null,
      createdBy: input.actorId,
    })
    .returning();
  if (!child) throw new Error("derived sample insert returned no row");

  await tx
    .insert(sampleLineage)
    .values({ parentId: parent.id, childId: child.id, relation: "derivation" });
  await recordCustodyEvent(tx, {
    sampleId: child.id,
    studyId: parent.studyId,
    eventType: "derivation",
    actorId: input.actorId,
    occurredAt: now,
    details: {
      parentId: parent.id,
      parentAccessionId: parent.accessionId,
      derivedFromType: parent.sampleType,
    },
  });
  await recordCustodyEvent(tx, {
    sampleId: parent.id,
    studyId: parent.studyId,
    eventType: "derivation",
    actorId: input.actorId,
    occurredAt: now,
    details: {
      childId: child.id,
      childAccessionId: child.accessionId,
      derivedType: input.derivedType,
    },
  });
  return { parent, child };
}

export interface PoolInput {
  parentIds: string[];
  studyId: string;
  studyOid: string;
  pooledType?: string;
  quantity?: number;
  quantityUnit?: string;
  actorId: string;
}

/**
 * Pools two or more parents into one specimen (ADR-0014): a `pool` lineage row
 * per parent plus a `pool` custody event on the pooled child and each parent.
 * The pooled type defaults to the parents' shared type; a pool that mixes
 * subjects has no single subject key.
 */
export async function poolSamples(tx: Tx, input: PoolInput) {
  const ids = [...new Set(input.parentIds)];
  if (ids.length < 2) throw new DomainError("a pool needs at least two source samples");

  const parents = await tx.select().from(samples).where(inArray(samples.id, ids));
  if (parents.length !== ids.length) throw new DomainError("one or more samples not found", 404);
  for (const p of parents) {
    if (p.studyId !== input.studyId) {
      throw new DomainError(`sample ${p.accessionId} is not in this study`, 400);
    }
    if (UNUSABLE.has(p.status)) {
      throw new DomainError(`sample ${p.accessionId} is ${p.status} and cannot be pooled`, 409);
    }
  }

  const types = new Set(parents.map((p) => p.sampleType));
  const pooledType = input.pooledType ?? (types.size === 1 ? [...types][0] : undefined);
  if (!pooledType) {
    throw new DomainError("sources are mixed types; specify a pooledType");
  }
  const subjects = new Set(parents.map((p) => p.subjectKey).filter((k): k is string => k !== null));
  const subjectKey =
    subjects.size === 1 && parents.every((p) => p.subjectKey) ? [...subjects][0] : null;
  const firstParent = parents[0] as (typeof parents)[number];

  const now = new Date();
  const accessionId = await nextAccessionId(tx, input.studyId, input.studyOid);
  const [pooled] = await tx
    .insert(samples)
    .values({
      studyId: input.studyId,
      siteId: firstParent.siteId,
      accessionId,
      sampleType: pooledType,
      subjectKey: subjectKey ?? null,
      receivedAt: now,
      quantity: input.quantity !== undefined ? String(input.quantity) : null,
      quantityUnit: input.quantityUnit ?? null,
      initialQuantity: input.quantity !== undefined ? String(input.quantity) : null,
      createdBy: input.actorId,
    })
    .returning();
  if (!pooled) throw new Error("pooled sample insert returned no row");

  await tx
    .insert(sampleLineage)
    .values(ids.map((parentId) => ({ parentId, childId: pooled.id, relation: "pool" })));

  await recordCustodyEvent(tx, {
    sampleId: pooled.id,
    studyId: input.studyId,
    eventType: "pool",
    actorId: input.actorId,
    occurredAt: now,
    details: {
      parentIds: ids,
      parentAccessionIds: parents.map((p) => p.accessionId),
    },
  });
  for (const p of parents) {
    await recordCustodyEvent(tx, {
      sampleId: p.id,
      studyId: input.studyId,
      eventType: "pool",
      actorId: input.actorId,
      occurredAt: now,
      details: { pooledId: pooled.id, pooledAccessionId: pooled.accessionId },
    });
  }
  return { pooled, parents };
}
