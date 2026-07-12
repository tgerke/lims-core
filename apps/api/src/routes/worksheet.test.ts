import { createDb, databaseUrl, runMigrations } from "@lims-core/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import {
  createTestService,
  createTestStudy,
  createTestUser,
  grantTestRole,
  TEST_PASSWORD,
  uniqueSuffix,
} from "../test-helpers.js";

/**
 * Worksheets/runs (ADR-0018): batch analysis orders and record the reagent lots
 * a run consumes, closing the seam to inventory (ADR-0016).
 */

let server: FastifyInstance;
let owner: ReturnType<typeof createDb>;
let studyId: string;
let siteId: string;
let serviceId: string;
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

async function makeOrder(token: string): Promise<string> {
  const sample = await server.inject({
    method: "POST",
    url: `/studies/${studyId}/samples`,
    headers: auth(token),
    payload: { siteId, sampleType: "serum" },
  });
  expect(sample.statusCode).toBe(201);
  const order = await server.inject({
    method: "POST",
    url: `/samples/${sample.json().id}/orders`,
    headers: auth(token),
    payload: { serviceId },
  });
  expect(order.statusCode).toBe(201);
  return order.json().id;
}

async function makeLot(token: string, quantity: number): Promise<string> {
  const item = await server.inject({
    method: "POST",
    url: "/inventory/items",
    headers: auth(token),
    payload: { name: `Reagent ${uniqueSuffix()}`, unit: "uL" },
  });
  expect(item.statusCode).toBe(201);
  const lot = await server.inject({
    method: "POST",
    url: "/inventory/lots",
    headers: auth(token),
    payload: { itemId: item.json().id, lotNumber: `LOT-${uniqueSuffix()}`, quantity },
  });
  expect(lot.statusCode).toBe(201);
  return lot.json().id;
}

async function makeWorksheet(token: string, requestIds: string[]): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: `/studies/${studyId}/worksheets`,
    headers: auth(token),
    payload: { requestIds, instrument: "Cobas e411" },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id;
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

  const created = await createTestStudy(owner.db);
  studyId = created.study.id;
  siteId = created.site.id;
  serviceId = (await createTestService(owner.db)).id;
  await grantTestRole(owner.db, tech.id, studyId, "technician", admin.id);
  await grantTestRole(owner.db, monitor.id, studyId, "monitor", admin.id);
});

afterAll(async () => {
  await server.close();
});

describe("worksheets / runs (ADR-0018)", () => {
  it("batches orders, records reagent use tied to the ledger, and runs the lifecycle", async () => {
    const token = await login(tech.username);
    const orderId = await makeOrder(token);
    const lotId = await makeLot(token, 100);

    const worksheetId = await makeWorksheet(token, [orderId]);

    const started = await server.inject({
      method: "POST",
      url: `/worksheets/${worksheetId}/start`,
      headers: auth(token),
    });
    expect(started.statusCode).toBe(200);
    expect(started.json().status).toBe("in_progress");

    // The seam: recording use draws from the lot AND links to the exact ledger row.
    const reagent = await server.inject({
      method: "POST",
      url: `/worksheets/${worksheetId}/reagents`,
      headers: auth(token),
      payload: { lotId, quantity: 30 },
    });
    expect(reagent.statusCode).toBe(201);

    const lotAfter = await owner.client`
      SELECT quantity_remaining FROM inventory_lot WHERE id = ${lotId}`;
    expect(Number(lotAfter[0]?.quantity_remaining)).toBe(70);

    const link = await owner.client`
      SELECT wr.quantity, it.reason, it.delta
      FROM worksheet_reagent wr
      JOIN inventory_transaction it ON it.id = wr.transaction_id
      WHERE wr.worksheet_id = ${worksheetId}`;
    expect(link).toHaveLength(1);
    expect(link[0]?.reason).toBe("consumed");
    expect(Number(link[0]?.delta)).toBe(-30);
    expect(Number(link[0]?.quantity)).toBe(30);

    const detail = await server.inject({
      url: `/worksheets/${worksheetId}`,
      headers: auth(token),
    });
    expect(detail.json().items).toHaveLength(1);
    expect(detail.json().reagents).toHaveLength(1);

    const completed = await server.inject({
      method: "POST",
      url: `/worksheets/${worksheetId}/complete`,
      headers: auth(token),
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().status).toBe("completed");
  });

  it("blocks recording reagent use on a completed run", async () => {
    const token = await login(tech.username);
    const worksheetId = await makeWorksheet(token, [await makeOrder(token)]);
    const lotId = await makeLot(token, 50);
    await server.inject({
      method: "POST",
      url: `/worksheets/${worksheetId}/start`,
      headers: auth(token),
    });
    await server.inject({
      method: "POST",
      url: `/worksheets/${worksheetId}/complete`,
      headers: auth(token),
    });
    const denied = await server.inject({
      method: "POST",
      url: `/worksheets/${worksheetId}/reagents`,
      headers: auth(token),
      payload: { lotId, quantity: 5 },
    });
    expect(denied.statusCode).toBe(409);
  });

  it("rejects completing a run that was never started", async () => {
    const token = await login(tech.username);
    const worksheetId = await makeWorksheet(token, [await makeOrder(token)]);
    const early = await server.inject({
      method: "POST",
      url: `/worksheets/${worksheetId}/complete`,
      headers: auth(token),
    });
    expect(early.statusCode).toBe(409);
  });

  it("rejects batching an order already in an open run", async () => {
    const token = await login(tech.username);
    const orderId = await makeOrder(token);
    await makeWorksheet(token, [orderId]);
    const dup = await server.inject({
      method: "POST",
      url: `/studies/${studyId}/worksheets`,
      headers: auth(token),
      payload: { requestIds: [orderId] },
    });
    expect(dup.statusCode).toBe(409);
  });

  it("requires worksheet.manage to assemble a run", async () => {
    const techToken = await login(tech.username);
    const orderId = await makeOrder(techToken);
    const monitorToken = await login(monitor.username);
    const denied = await server.inject({
      method: "POST",
      url: `/studies/${studyId}/worksheets`,
      headers: auth(monitorToken),
      payload: { requestIds: [orderId] },
    });
    expect(denied.statusCode).toBe(403);
  });
});
