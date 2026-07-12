import {
  analysisRequests,
  worksheetCounters,
  worksheetItems,
  worksheetReagents,
  worksheets,
} from "@lims-core/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "./actor.js";
import { DomainError } from "./errors.js";
import { consumeLot } from "./inventory.js";

/** `STUDY-001-WS-00042`: sanitized study OID + zero-padded per-study number. */
export function formatWorksheetNumber(studyOid: string, sequence: number): string {
  const prefix = studyOid
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${prefix}-WS-${String(sequence).padStart(5, "0")}`;
}

// An order can join a run while it is still open for work; a signed or
// cancelled order is closed and cannot be batched.
const BATCHABLE_STATUSES = new Set(["ordered", "resulted", "verified"]);
const OPEN_WORKSHEET_STATUSES = ["draft", "in_progress"];

export interface CreateWorksheetInput {
  studyId: string;
  studyOid: string;
  instrument?: string;
  notes?: string;
  requestIds: string[];
  actorId: string;
}

/**
 * Assembles a run (ADR-0018): allocates the next per-study worksheet number,
 * creates it in `draft`, and batches the given orders. Rejects orders that are
 * not in the study, closed (signed/cancelled), or already in an open run.
 */
export async function createWorksheet(tx: Tx, input: CreateWorksheetInput) {
  const ids = [...new Set(input.requestIds)];
  if (ids.length === 0) throw new DomainError("a worksheet needs at least one order");

  const rows = await tx.select().from(analysisRequests).where(inArray(analysisRequests.id, ids));
  if (rows.length !== ids.length) throw new DomainError("one or more orders not found", 404);
  for (const r of rows) {
    if (r.studyId !== input.studyId) {
      throw new DomainError("one or more orders are not in this study", 400);
    }
    if (!BATCHABLE_STATUSES.has(r.status)) {
      throw new DomainError(`order ${r.id} is ${r.status} and cannot be batched`, 409);
    }
  }

  const open = await tx
    .select({ requestId: worksheetItems.requestId })
    .from(worksheetItems)
    .innerJoin(worksheets, eq(worksheetItems.worksheetId, worksheets.id))
    .where(
      and(
        inArray(worksheetItems.requestId, ids),
        inArray(worksheets.status, OPEN_WORKSHEET_STATUSES),
      ),
    );
  if (open.length > 0) {
    throw new DomainError("one or more orders are already in an open worksheet", 409);
  }

  const [counter] = await tx
    .insert(worksheetCounters)
    .values({ studyId: input.studyId, lastValue: 1 })
    .onConflictDoUpdate({
      target: worksheetCounters.studyId,
      set: { lastValue: sql`${worksheetCounters.lastValue} + 1` },
    })
    .returning({ lastValue: worksheetCounters.lastValue });
  if (!counter) throw new Error("worksheet counter returned no row");

  const [worksheet] = await tx
    .insert(worksheets)
    .values({
      studyId: input.studyId,
      worksheetNumber: formatWorksheetNumber(input.studyOid, counter.lastValue),
      instrument: input.instrument ?? null,
      notes: input.notes ?? null,
      createdBy: input.actorId,
    })
    .returning();
  if (!worksheet) throw new Error("worksheet insert returned no row");

  await tx
    .insert(worksheetItems)
    .values(
      ids.map((requestId) => ({ worksheetId: worksheet.id, requestId, studyId: input.studyId })),
    );

  return { worksheet, requestIds: ids };
}

async function loadWorksheet(tx: Tx, worksheetId: string) {
  const [worksheet] = await tx
    .select()
    .from(worksheets)
    .where(eq(worksheets.id, worksheetId))
    .limit(1);
  if (!worksheet) throw new DomainError("worksheet not found", 404);
  return worksheet;
}

export interface RecordReagentInput {
  worksheetId: string;
  lotId: string;
  quantity: number;
  note?: string;
  actorId: string;
}

/**
 * Records a run's reagent draw (the seam, ADR-0018): consumes from the lot
 * through the inventory ledger and links the resulting transaction to the
 * worksheet. Allowed while the run is open (draft or in_progress).
 */
export async function recordReagentUse(tx: Tx, input: RecordReagentInput) {
  const worksheet = await loadWorksheet(tx, input.worksheetId);
  if (!OPEN_WORKSHEET_STATUSES.includes(worksheet.status)) {
    throw new DomainError(
      `worksheet is ${worksheet.status}; reagents can only be added while open`,
      409,
    );
  }

  const { lot, transaction } = await consumeLot(tx, {
    lotId: input.lotId,
    quantity: input.quantity,
    note: input.note ?? `worksheet ${worksheet.worksheetNumber}`,
    actorId: input.actorId,
  });

  const [link] = await tx
    .insert(worksheetReagents)
    .values({
      worksheetId: worksheet.id,
      lotId: lot.id,
      transactionId: transaction.id,
      studyId: worksheet.studyId,
      quantity: String(input.quantity),
    })
    .returning();
  if (!link) throw new Error("worksheet reagent insert returned no row");
  return { link, lot };
}

/** Starts a run (ADR-0018): draft -> in_progress. */
export async function startWorksheet(tx: Tx, input: { worksheetId: string; actorId: string }) {
  const worksheet = await loadWorksheet(tx, input.worksheetId);
  if (worksheet.status !== "draft") {
    throw new DomainError(`worksheet is ${worksheet.status}; only a draft run can be started`, 409);
  }
  const now = new Date();
  const [updated] = await tx
    .update(worksheets)
    .set({ status: "in_progress", startedAt: now, updatedAt: now })
    .where(eq(worksheets.id, worksheet.id))
    .returning();
  return updated ?? worksheet;
}

/** Completes a run (ADR-0018): in_progress -> completed. */
export async function completeWorksheet(tx: Tx, input: { worksheetId: string; actorId: string }) {
  const worksheet = await loadWorksheet(tx, input.worksheetId);
  if (worksheet.status !== "in_progress") {
    throw new DomainError(
      `worksheet is ${worksheet.status}; only an in-progress run can be completed`,
      409,
    );
  }
  const now = new Date();
  const [updated] = await tx
    .update(worksheets)
    .set({ status: "completed", completedAt: now, updatedAt: now })
    .where(eq(worksheets.id, worksheet.id))
    .returning();
  return updated ?? worksheet;
}
