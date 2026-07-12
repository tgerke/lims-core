import { createHash } from "node:crypto";
import {
  analysisRequests,
  analysisServices,
  certificatesOfAnalysis,
  coaCounters,
  type Db,
  results,
  samples,
  studies,
  users,
} from "@lims-core/db";
import { desc, eq, sql } from "drizzle-orm";
import type { Tx } from "./actor.js";
import { DomainError } from "./errors.js";

// A CoA certifies released results only: verified or signed, not draft entries.
const RELEASED_STATUSES = ["verified", "signed"];

/** `STUDY-001-COA-00042`: sanitized study OID + zero-padded per-study number. */
export function formatCoaNumber(studyOid: string, sequence: number): string {
  const prefix = studyOid
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${prefix}-COA-${String(sequence).padStart(5, "0")}`;
}

export interface CoaAnalyte {
  serviceCode: string;
  serviceName: string;
  value: string;
  unit: string | null;
  qcStatus: string;
  source: string;
  status: string;
  resultVersion: number;
}

export interface CoaSnapshot {
  study: { oid: string; name: string };
  sample: { accessionId: string; sampleType: string; subjectKey: string | null };
  analytes: CoaAnalyte[];
  issuedBy: { username: string; fullName: string | null };
  issuedAt: string;
}

/**
 * Canonical hash of a CoA snapshot (ADR-0022): stable JSON with sorted keys, so
 * the same certified content always hashes identically and the rendered PDF can
 * be proven to match what was certified. Mirrors the e-signature record hash.
 */
export function coaContentHash(snapshot: CoaSnapshot): string {
  return createHash("sha256").update(stableStringify(snapshot)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * Issues a Certificate of Analysis for a sample (ADR-0022): snapshots the
 * sample's currently released (verified/signed) results with their spec verdicts
 * and QC, hashes the snapshot, allocates the next per-study CoA number, and
 * appends an immutable record. Fails if the sample has no released results.
 */
export async function issueCertificate(tx: Tx, input: { sampleId: string; actorId: string }) {
  const [sample] = await tx.select().from(samples).where(eq(samples.id, input.sampleId)).limit(1);
  if (!sample) throw new DomainError("sample not found", 404);

  const [study] = await tx.select().from(studies).where(eq(studies.id, sample.studyId)).limit(1);
  if (!study) throw new DomainError("study not found", 404);

  const [issuer] = await tx.select().from(users).where(eq(users.id, input.actorId)).limit(1);
  if (!issuer) throw new DomainError("issuing user not found", 404);

  // Orders on the sample and their current result version.
  const orders = await tx
    .select({
      requestId: analysisRequests.id,
      serviceCode: analysisServices.code,
      serviceName: analysisServices.name,
    })
    .from(analysisRequests)
    .innerJoin(analysisServices, eq(analysisRequests.serviceId, analysisServices.id))
    .where(eq(analysisRequests.sampleId, sample.id))
    .orderBy(analysisServices.code);

  const analytes: CoaAnalyte[] = [];
  for (const order of orders) {
    const [current] = await tx
      .select()
      .from(results)
      .where(eq(results.requestId, order.requestId))
      .orderBy(desc(results.version))
      .limit(1);
    if (!current || !RELEASED_STATUSES.includes(current.status)) continue;
    analytes.push({
      serviceCode: order.serviceCode,
      serviceName: order.serviceName,
      value: current.value,
      unit: current.unit,
      qcStatus: current.qcStatus,
      source: current.source,
      status: current.status,
      resultVersion: current.version,
    });
  }
  if (analytes.length === 0) {
    throw new DomainError("sample has no released results to certify", 409);
  }

  const issuedAt = new Date();
  const snapshot: CoaSnapshot = {
    study: { oid: study.oid, name: study.name },
    sample: {
      accessionId: sample.accessionId,
      sampleType: sample.sampleType,
      subjectKey: sample.subjectKey,
    },
    analytes,
    issuedBy: { username: issuer.username, fullName: issuer.fullName },
    issuedAt: issuedAt.toISOString(),
  };
  const contentHash = coaContentHash(snapshot);

  const [counter] = await tx
    .insert(coaCounters)
    .values({ studyId: sample.studyId, lastValue: 1 })
    .onConflictDoUpdate({
      target: coaCounters.studyId,
      set: { lastValue: sql`${coaCounters.lastValue} + 1` },
    })
    .returning({ lastValue: coaCounters.lastValue });
  if (!counter) throw new Error("coa counter returned no row");

  const [row] = await tx
    .insert(certificatesOfAnalysis)
    .values({
      sampleId: sample.id,
      studyId: sample.studyId,
      coaNumber: formatCoaNumber(study.oid, counter.lastValue),
      snapshot,
      contentHash,
      issuedBy: input.actorId,
      issuedAt,
    })
    .returning();
  if (!row) throw new Error("certificate insert returned no row");
  return row;
}

/** Loads an issued CoA by id (its snapshot is the source of truth for rendering). */
export async function getCertificate(tx: Db | Tx, coaId: string) {
  const [row] = await tx
    .select()
    .from(certificatesOfAnalysis)
    .where(eq(certificatesOfAnalysis.id, coaId))
    .limit(1);
  return row ?? null;
}
