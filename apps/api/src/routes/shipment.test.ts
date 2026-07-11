import { createDb, databaseUrl, runMigrations } from "@lims-core/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import {
  createTestBox,
  createTestStudy,
  createTestUser,
  grantTestRole,
  TEST_PASSWORD,
  uniqueSuffix,
} from "../test-helpers.js";

/**
 * Shipment custody handoff (CoC-06): packing, shipping, and receiving move a
 * sample's custody unbroken from origin to destination, with the send/receive
 * separation of duties enforced by RBAC.
 */

let server: FastifyInstance;
let owner: ReturnType<typeof createDb>;

let studyId: string;
let siteId: string;
let boxId: string;
let tech: { id: string; username: string };
let receiver: { id: string; username: string };
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

async function accession(token: string): Promise<{ id: string; accessionId: string }> {
  const res = await server.inject({
    method: "POST",
    url: `/studies/${studyId}/samples`,
    headers: auth(token),
    payload: { siteId, sampleType: "serum" },
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

function detail(token: string, sampleId: string) {
  return server.inject({ url: `/samples/${sampleId}`, headers: auth(token) });
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
  receiver = await createTestUser(owner.db, { username: `recv-${suffix}` });
  monitor = await createTestUser(owner.db, { username: `mon-${suffix}` });

  const created = await createTestStudy(owner.db);
  studyId = created.study.id;
  siteId = created.site.id;
  await grantTestRole(owner.db, tech.id, studyId, "technician", admin.id);
  await grantTestRole(owner.db, receiver.id, studyId, "accessioner", admin.id);
  await grantTestRole(owner.db, monitor.id, studyId, "monitor", admin.id);

  boxId = (await createTestBox(owner.db, 3, 3)).id;
});

afterAll(async () => {
  await server.close();
});

function transferPhases(custody: { eventType: string; details: { phase?: string } | null }[]) {
  return custody.filter((c) => c.eventType === "transfer").map((c) => c.details?.phase);
}

describe("shipment custody handoff (CoC-06)", () => {
  it("packs, ships, and receives, moving custody unbroken", async () => {
    const token = await login(tech.username);
    const a = await accession(token);
    const b = await accession(token);

    // Store one sample so we can prove it leaves storage on ship.
    await server.inject({
      method: "POST",
      url: `/samples/${a.id}/store`,
      headers: auth(token),
      payload: { storageUnitId: boxId, position: "A1" },
    });

    const created = await server.inject({
      method: "POST",
      url: `/studies/${studyId}/shipments`,
      headers: auth(token),
      payload: {
        destination: "Central Biorepository",
        originSiteId: siteId,
        carrier: "World Courier",
        sampleIds: [a.id, b.id],
      },
    });
    expect(created.statusCode).toBe(201);
    const shipment = created.json();
    expect(shipment.shipmentNumber).toMatch(/^TEST-.*-SHP-\d{5}$/);
    expect(shipment.status).toBe("packed");

    // Ship: samples go in transit, out of storage, with a transfer event.
    const shipped = await server.inject({
      method: "POST",
      url: `/shipments/${shipment.id}/ship`,
      headers: auth(token),
    });
    expect(shipped.statusCode).toBe(200);
    expect(shipped.json().status).toBe("in_transit");

    const aShipped = (await detail(token, a.id)).json();
    expect(aShipped.status).toBe("in_transit");
    expect(aShipped.storageUnit).toBeNull();
    expect(aShipped.storagePosition).toBeNull();
    expect(transferPhases(aShipped.custody)).toEqual(["shipped"]);

    // Receive: back to registered at the destination, with an arrival event.
    const receiverToken = await login(receiver.username);
    const received = await server.inject({
      method: "POST",
      url: `/shipments/${shipment.id}/receive`,
      headers: auth(receiverToken),
    });
    expect(received.statusCode).toBe(200);
    expect(received.json().status).toBe("received");

    const aReceived = (await detail(token, a.id)).json();
    expect(aReceived.status).toBe("registered");
    expect(transferPhases(aReceived.custody)).toEqual(["shipped", "received"]);

    const detailRes = await server.inject({
      url: `/shipments/${shipment.id}`,
      headers: auth(token),
    });
    expect(detailRes.json().items).toHaveLength(2);
  });

  it("rejects packing a sample already in an open shipment", async () => {
    const token = await login(tech.username);
    const a = await accession(token);
    const first = await server.inject({
      method: "POST",
      url: `/studies/${studyId}/shipments`,
      headers: auth(token),
      payload: { destination: "Central", sampleIds: [a.id] },
    });
    expect(first.statusCode).toBe(201);

    const second = await server.inject({
      method: "POST",
      url: `/studies/${studyId}/shipments`,
      headers: auth(token),
      payload: { destination: "Central", sampleIds: [a.id] },
    });
    expect(second.statusCode).toBe(409);
  });

  it("rejects out-of-order transitions", async () => {
    const token = await login(tech.username);
    const a = await accession(token);
    const created = await server.inject({
      method: "POST",
      url: `/studies/${studyId}/shipments`,
      headers: auth(token),
      payload: { destination: "Central", sampleIds: [a.id] },
    });
    const id = created.json().id;

    // Receiving before shipping is invalid.
    const receiverToken = await login(receiver.username);
    const early = await server.inject({
      method: "POST",
      url: `/shipments/${id}/receive`,
      headers: auth(receiverToken),
    });
    expect(early.statusCode).toBe(409);

    await server.inject({ method: "POST", url: `/shipments/${id}/ship`, headers: auth(token) });
    // Shipping a second time is invalid.
    const twice = await server.inject({
      method: "POST",
      url: `/shipments/${id}/ship`,
      headers: auth(token),
    });
    expect(twice.statusCode).toBe(409);
  });

  it("enforces the send/receive separation of duties", async () => {
    const token = await login(tech.username);
    const a = await accession(token);

    // Accessioner holds shipment.receive but not shipment.send.
    const receiverToken = await login(receiver.username);
    const packDenied = await server.inject({
      method: "POST",
      url: `/studies/${studyId}/shipments`,
      headers: auth(receiverToken),
      payload: { destination: "Central", sampleIds: [a.id] },
    });
    expect(packDenied.statusCode).toBe(403);

    const created = await server.inject({
      method: "POST",
      url: `/studies/${studyId}/shipments`,
      headers: auth(token),
      payload: { destination: "Central", sampleIds: [a.id] },
    });
    const id = created.json().id;
    await server.inject({ method: "POST", url: `/shipments/${id}/ship`, headers: auth(token) });

    // Monitor holds neither send nor receive.
    const monitorToken = await login(monitor.username);
    const recvDenied = await server.inject({
      method: "POST",
      url: `/shipments/${id}/receive`,
      headers: auth(monitorToken),
    });
    expect(recvDenied.statusCode).toBe(403);
  });
});
