import { accessionCounters, samples } from "@lims-core/db";
import { formatAccessionId } from "@lims-core/labels";
import { sql } from "drizzle-orm";
import type { Tx } from "./actor.js";
import { recordCustodyEvent } from "./custody.js";

export interface AccessionInput {
  studyId: string;
  studyOid: string;
  siteId: string;
  sampleType: string;
  subjectKey?: string;
  studyEventOid?: string;
  collectedAt?: Date;
  actorId: string;
}

/**
 * Accessions a sample: allocates the next per-study accession number, creates
 * the sample, and opens its chain of custody (collection when a collection
 * time is known, then receipt — CoC-01). Runs inside withActor so the audit
 * chain attributes every row.
 */
export async function accessionSample(tx: Tx, input: AccessionInput) {
  const [counter] = await tx
    .insert(accessionCounters)
    .values({ studyId: input.studyId, lastValue: 1 })
    .onConflictDoUpdate({
      target: accessionCounters.studyId,
      set: { lastValue: sql`${accessionCounters.lastValue} + 1` },
    })
    .returning({ lastValue: accessionCounters.lastValue });
  if (!counter) throw new Error("accession counter returned no row");
  const accessionId = formatAccessionId(input.studyOid, counter.lastValue);

  const now = new Date();
  const [sample] = await tx
    .insert(samples)
    .values({
      studyId: input.studyId,
      siteId: input.siteId,
      accessionId,
      sampleType: input.sampleType,
      subjectKey: input.subjectKey ?? null,
      studyEventOid: input.studyEventOid ?? null,
      collectedAt: input.collectedAt ?? null,
      receivedAt: now,
      createdBy: input.actorId,
    })
    .returning();
  if (!sample) throw new Error("sample insert returned no row");

  if (input.collectedAt) {
    await recordCustodyEvent(tx, {
      sampleId: sample.id,
      studyId: input.studyId,
      eventType: "collection",
      actorId: input.actorId,
      occurredAt: input.collectedAt,
    });
  }
  await recordCustodyEvent(tx, {
    sampleId: sample.id,
    studyId: input.studyId,
    eventType: "receipt",
    actorId: input.actorId,
    occurredAt: now,
  });
  return sample;
}
