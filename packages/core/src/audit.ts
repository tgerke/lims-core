import type { Db } from "@lims-core/db";
import { sql } from "drizzle-orm";

/** Chain scope key for a study's audit chain (ADR-0002). */
export function studyChainScope(studyId: string): string {
  return `study:${studyId}`;
}

export interface ChainProblem {
  chainScope: string;
  eventId: number;
  problem: string;
}

/**
 * Replays the hash chain in the database (P11-03). Empty result = chain
 * verifies. Pass a scope to check one study; omit to check every chain.
 */
export async function verifyAuditChain(db: Db, scope?: string): Promise<ChainProblem[]> {
  const rows = await db.execute(
    sql`SELECT chain_scope, event_id, problem FROM lims_verify_audit_chain(${scope ?? null})`,
  );
  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    chainScope: String(r.chain_scope),
    eventId: Number(r.event_id),
    problem: String(r.problem),
  }));
}
