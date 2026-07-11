import { createDb, databaseUrl, runMigrations } from "@lims-core/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import {
  createTestStudy,
  createTestUser,
  grantTestRole,
  TEST_PASSWORD,
  uniqueSuffix,
} from "../test-helpers.js";

/**
 * Reagent/consumable inventory (ADR-0016): lab-wide catalog items, received
 * lots with expiry and on-hand quantity, and an append-only consumption ledger.
 */

let server: FastifyInstance;
let owner: ReturnType<typeof createDb>;

let tech: { id: string; username: string };
let monitor: { id: string; username: string };

async function login(username: string): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: "/auth/login",
    payload: { username, password: TEST_PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { token: string }).token;
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function catalogItem(token: string): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: "/inventory/items",
    headers: auth(token),
    payload: { name: `Taq polymerase ${uniqueSuffix()}`, unit: "uL", category: "reagent" },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id;
}

async function receiveLot(
  token: string,
  itemId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; status: string; quantityRemaining: string }> {
  const res = await server.inject({
    method: "POST",
    url: "/inventory/lots",
    headers: auth(token),
    payload: { itemId, lotNumber: `LOT-${uniqueSuffix()}`, quantity: 100, ...overrides },
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

beforeAll(async () => {
  await runMigrations();
  owner = createDb(databaseUrl());
  server = await buildServer({ db: owner.db });

  const suffix = uniqueSuffix();
  const admin = await createTestUser(owner.db, {
    username: `admin-${suffix}`,
    isSystemAdmin: true,
  });
  tech = await createTestUser(owner.db, { username: `tech-${suffix}` });
  monitor = await createTestUser(owner.db, { username: `mon-${suffix}` });

  const { study } = await createTestStudy(owner.db);
  await grantTestRole(owner.db, tech.id, study.id, "technician", admin.id);
  await grantTestRole(owner.db, monitor.id, study.id, "monitor", admin.id);
});

afterAll(async () => {
  await server.close();
});

describe("reagent inventory (ADR-0016)", () => {
  it("catalogs an item, receives a lot, consumes it to depletion", async () => {
    const token = await login(tech.username);
    const itemId = await catalogItem(token);
    const lot = await receiveLot(token, itemId, { quantity: 100 });
    expect(lot.status).toBe("available");
    expect(Number(lot.quantityRemaining)).toBe(100);

    const consumed = await server.inject({
      method: "POST",
      url: `/inventory/lots/${lot.id}/consume`,
      headers: auth(token),
      payload: { quantity: 60, note: "PCR run 1" },
    });
    expect(consumed.statusCode).toBe(200);
    expect(Number(consumed.json().quantityRemaining)).toBe(40);
    expect(consumed.json().status).toBe("available");

    const drained = await server.inject({
      method: "POST",
      url: `/inventory/lots/${lot.id}/consume`,
      headers: auth(token),
      payload: { quantity: 40 },
    });
    expect(drained.statusCode).toBe(200);
    expect(Number(drained.json().quantityRemaining)).toBe(0);
    expect(drained.json().status).toBe("depleted");

    // The append-only ledger reconciles to the denormalized remaining.
    const ledger = await owner.client`
      SELECT COALESCE(SUM(delta), 0) AS net FROM inventory_transaction WHERE lot_id = ${lot.id}`;
    expect(Number(ledger[0]?.net)).toBe(0);
  });

  it("rejects an over-draw", async () => {
    const token = await login(tech.username);
    const itemId = await catalogItem(token);
    const lot = await receiveLot(token, itemId, { quantity: 10 });
    const res = await server.inject({
      method: "POST",
      url: `/inventory/lots/${lot.id}/consume`,
      headers: auth(token),
      payload: { quantity: 25 },
    });
    expect(res.statusCode).toBe(409);
  });

  it("refuses consumption from an expired lot", async () => {
    const token = await login(tech.username);
    const itemId = await catalogItem(token);
    const lot = await receiveLot(token, itemId, { quantity: 50, expiryDate: "2020-01-01" });
    const res = await server.inject({
      method: "POST",
      url: `/inventory/lots/${lot.id}/consume`,
      headers: auth(token),
      payload: { quantity: 5 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/expired/);
  });

  it("refuses consumption from a discarded lot", async () => {
    const token = await login(tech.username);
    const itemId = await catalogItem(token);
    const lot = await receiveLot(token, itemId, { quantity: 50 });
    const discarded = await server.inject({
      method: "POST",
      url: `/inventory/lots/${lot.id}/discard`,
      headers: auth(token),
      payload: { note: "contaminated" },
    });
    expect(discarded.statusCode).toBe(200);
    expect(discarded.json().status).toBe("discarded");
    const res = await server.inject({
      method: "POST",
      url: `/inventory/lots/${lot.id}/consume`,
      headers: auth(token),
      payload: { quantity: 5 },
    });
    expect(res.statusCode).toBe(409);
  });

  it("requires inventory.manage to catalog or receive", async () => {
    const monitorToken = await login(monitor.username);
    const denied = await server.inject({
      method: "POST",
      url: "/inventory/items",
      headers: auth(monitorToken),
      payload: { name: "Ethanol", unit: "mL" },
    });
    expect(denied.statusCode).toBe(403);
  });

  it("keeps the transaction ledger append-only, even for the owner (P11-01)", async () => {
    const token = await login(tech.username);
    const itemId = await catalogItem(token);
    const lot = await receiveLot(token, itemId, { quantity: 30 });
    await expect(
      owner.client`UPDATE inventory_transaction SET delta = 999 WHERE lot_id = ${lot.id}`,
    ).rejects.toThrow(/append-only/);
    await expect(
      owner.client`DELETE FROM inventory_transaction WHERE lot_id = ${lot.id}`,
    ).rejects.toThrow(/append-only/);
  });
});
