import { bigserial, char, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Written exclusively by the SECURITY DEFINER trigger (0001/0002); the
// runtime role has no INSERT. Drizzle sees it read-only in practice.
export const auditEvents = pgTable(
  "audit_event",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    chainScope: text("chain_scope").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    actorId: uuid("actor_id"),
    actorLabel: text("actor_label").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    prevHash: char("prev_hash", { length: 64 }).notNull(),
    hash: char("hash", { length: 64 }).notNull(),
  },
  (t) => [
    index("audit_event_chain_lookup").on(t.chainScope, t.id),
    index("audit_event_entity_lookup").on(t.entityType, t.entityId),
  ],
);
