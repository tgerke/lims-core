import { accessionSample } from "./accession.js";
import type { Tx } from "./actor.js";
import { DomainError } from "./errors.js";
import { freeBoxPositions, storeSample } from "./storage.js";

export interface BulkAccessionInput {
  studyId: string;
  studyOid: string;
  siteId: string;
  sampleType: string;
  count: number;
  subjectKey?: string;
  studyEventOid?: string;
  collectedAt?: Date;
  /** Optional box to fill sequentially from the first free position. */
  storageUnitId?: string;
  actorId: string;
}

/**
 * Accessions `count` samples that share site/type (CoC-01), each with its own
 * accession number and custody chain. When a box is given, the batch is placed
 * sequentially from the first free position (CoC-03); the whole run is one
 * transaction, so a capacity shortfall or any failure rolls it all back.
 */
export async function bulkAccessionSamples(tx: Tx, input: BulkAccessionInput) {
  let positions: string[] = [];
  if (input.storageUnitId) {
    positions = await freeBoxPositions(tx, input.storageUnitId);
    if (positions.length < input.count) {
      throw new DomainError(
        `box has ${positions.length} free positions but ${input.count} samples were requested`,
        409,
      );
    }
  }

  const shared = {
    studyId: input.studyId,
    studyOid: input.studyOid,
    siteId: input.siteId,
    sampleType: input.sampleType,
    actorId: input.actorId,
    ...(input.subjectKey ? { subjectKey: input.subjectKey } : {}),
    ...(input.studyEventOid ? { studyEventOid: input.studyEventOid } : {}),
    ...(input.collectedAt ? { collectedAt: input.collectedAt } : {}),
  };

  const created = [];
  for (let i = 0; i < input.count; i++) {
    const sample = await accessionSample(tx, shared);
    const position = positions[i];
    if (input.storageUnitId && position) {
      await storeSample(tx, {
        sampleId: sample.id,
        storageUnitId: input.storageUnitId,
        position,
        actorId: input.actorId,
      });
    }
    created.push(sample);
  }
  return created;
}
