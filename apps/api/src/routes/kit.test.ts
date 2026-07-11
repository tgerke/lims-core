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
 * Collection kits (ADR-0011): empty containers assembled centrally and sent to a
 * site, with an assemble -> ship -> deliver lifecycle guarded server-side.
 */

let server: FastifyInstance;
let owner: ReturnType<typeof createDb>;

let studyId: string;
let siteId: string;
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
  await grantTestRole(owner.db, tech.id, studyId, "technician", admin.id);
  await grantTestRole(owner.db, monitor.id, studyId, "monitor", admin.id);
});

afterAll(async () => {
  await server.close();
});

describe("collection kits (ADR-0011)", () => {
  it("assembles, ships, and delivers a kit", async () => {
    const token = await login(tech.username);
    const created = await server.inject({
      method: "POST",
      url: `/studies/${studyId}/kits`,
      headers: auth(token),
      payload: {
        destinationSiteId: siteId,
        carrier: "World Courier",
        items: [
          { containerType: "EDTA tube", quantity: 10 },
          { containerType: "Serum tube", quantity: 5 },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    const kit = created.json();
    expect(kit.kitNumber).toMatch(/^TEST-.*-KIT-\d{5}$/);
    expect(kit.status).toBe("assembled");

    const shipped = await server.inject({
      method: "POST",
      url: `/kits/${kit.id}/ship`,
      headers: auth(token),
    });
    expect(shipped.statusCode).toBe(200);
    expect(shipped.json().status).toBe("shipped");
    expect(shipped.json().shippedAt).not.toBeNull();

    const delivered = await server.inject({
      method: "POST",
      url: `/kits/${kit.id}/deliver`,
      headers: auth(token),
    });
    expect(delivered.statusCode).toBe(200);
    expect(delivered.json().status).toBe("delivered");

    const list = await server.inject({
      url: `/studies/${studyId}/kits`,
      headers: auth(token),
    });
    const row = list.json().find((k: { id: string }) => k.id === kit.id);
    expect(row.items).toHaveLength(2);
    expect(row.destinationSite).toBe("SITE-01");
  });

  it("rejects out-of-order transitions", async () => {
    const token = await login(tech.username);
    const created = await server.inject({
      method: "POST",
      url: `/studies/${studyId}/kits`,
      headers: auth(token),
      payload: { destinationSiteId: siteId, items: [{ containerType: "Cryovial", quantity: 20 }] },
    });
    const id = created.json().id;
    // Delivering before shipping is invalid.
    const early = await server.inject({
      method: "POST",
      url: `/kits/${id}/deliver`,
      headers: auth(token),
    });
    expect(early.statusCode).toBe(409);
  });

  it("requires kit.manage to assemble a kit", async () => {
    const monitorToken = await login(monitor.username);
    const denied = await server.inject({
      method: "POST",
      url: `/studies/${studyId}/kits`,
      headers: auth(monitorToken),
      payload: { destinationSiteId: siteId, items: [{ containerType: "Cryovial", quantity: 1 }] },
    });
    expect(denied.statusCode).toBe(403);
  });
});
