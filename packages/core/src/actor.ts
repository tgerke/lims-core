import type { Db } from "@lims-core/db";
import { sql } from "drizzle-orm";

/** The acting identity recorded on every audit event in the transaction. */
export interface Actor {
  userId?: string;
  label: string;
}

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Run `fn` in a transaction with the actor bound via set_config, so the
 * database audit triggers (ADR-0002) attribute every write in it. Ported
 * from ctms-core packages/core/src/actor.ts.
 */
export async function withActor<T>(db: Db, actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT set_config('lims.actor_id', ${actor.userId ?? ""}, true),
             set_config('lims.actor_label', ${actor.label}, true)`);
    return fn(tx);
  });
}
