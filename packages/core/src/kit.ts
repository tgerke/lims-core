import { kitCounters, kitItems, kits, sites } from "@lims-core/db";
import { eq, sql } from "drizzle-orm";
import type { Tx } from "./actor.js";
import { DomainError } from "./errors.js";

/** `STUDY-001-KIT-00042`: sanitized study OID + zero-padded per-study number. */
export function formatKitNumber(studyOid: string, sequence: number): string {
  const prefix = studyOid
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${prefix}-KIT-${String(sequence).padStart(5, "0")}`;
}

export interface KitItemInput {
  containerType: string;
  quantity: number;
}

export interface CreateKitInput {
  studyId: string;
  studyOid: string;
  destinationSiteId: string;
  carrier?: string;
  trackingNumber?: string;
  notes?: string;
  items: KitItemInput[];
  actorId: string;
}

/**
 * Assembles a collection kit (ADR-0011): allocates the next per-study kit
 * number, creates the kit in `assembled` state bound to a destination site, and
 * records its container contents. Empty containers, so no custody events — the
 * kit's own audited lifecycle is the trail. Runs inside withActor.
 */
export async function createKit(tx: Tx, input: CreateKitInput) {
  if (input.items.length === 0) throw new DomainError("a kit needs at least one container item");

  const [site] = await tx
    .select()
    .from(sites)
    .where(eq(sites.id, input.destinationSiteId))
    .limit(1);
  if (!site) throw new DomainError("destination site not found", 404);
  if (site.studyId !== input.studyId) {
    throw new DomainError("destination site does not belong to this study", 400);
  }

  const [counter] = await tx
    .insert(kitCounters)
    .values({ studyId: input.studyId, lastValue: 1 })
    .onConflictDoUpdate({
      target: kitCounters.studyId,
      set: { lastValue: sql`${kitCounters.lastValue} + 1` },
    })
    .returning({ lastValue: kitCounters.lastValue });
  if (!counter) throw new Error("kit counter returned no row");

  const [kit] = await tx
    .insert(kits)
    .values({
      studyId: input.studyId,
      kitNumber: formatKitNumber(input.studyOid, counter.lastValue),
      destinationSiteId: input.destinationSiteId,
      carrier: input.carrier ?? null,
      trackingNumber: input.trackingNumber ?? null,
      notes: input.notes ?? null,
      createdBy: input.actorId,
    })
    .returning();
  if (!kit) throw new Error("kit insert returned no row");

  await tx.insert(kitItems).values(
    input.items.map((i) => ({
      kitId: kit.id,
      studyId: input.studyId,
      containerType: i.containerType,
      quantity: i.quantity,
    })),
  );

  return kit;
}

async function loadKit(tx: Tx, kitId: string) {
  const [kit] = await tx.select().from(kits).where(eq(kits.id, kitId)).limit(1);
  if (!kit) throw new DomainError("kit not found", 404);
  return kit;
}

/** Dispatches an assembled kit to its site (ADR-0011): marks it shipped. */
export async function shipKit(tx: Tx, input: { kitId: string; actorId: string }) {
  const kit = await loadKit(tx, input.kitId);
  if (kit.status !== "assembled") {
    throw new DomainError(`kit is ${kit.status}; only an assembled kit can ship`, 409);
  }
  const now = new Date();
  const [updated] = await tx
    .update(kits)
    .set({ status: "shipped", shippedAt: now, updatedAt: now })
    .where(eq(kits.id, kit.id))
    .returning();
  return updated ?? kit;
}

/** Confirms a shipped kit arrived at the site (ADR-0011): marks it delivered. */
export async function deliverKit(tx: Tx, input: { kitId: string; actorId: string }) {
  const kit = await loadKit(tx, input.kitId);
  if (kit.status !== "shipped") {
    throw new DomainError(`kit is ${kit.status}; only a shipped kit can be delivered`, 409);
  }
  const now = new Date();
  const [updated] = await tx
    .update(kits)
    .set({ status: "delivered", deliveredAt: now, updatedAt: now })
    .where(eq(kits.id, kit.id))
    .returning();
  return updated ?? kit;
}
