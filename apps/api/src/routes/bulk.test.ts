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
 * Bulk accessioning (throughput) and the freezer map (usability). Bulk reuses
 * the per-sample custody controls (CoC-01/03); the map is study-scoped — a
 * shared box shows another study's samples as occupied positions only.
 */

let server: FastifyInstance;
let owner: ReturnType<typeof createDb>;

let studyA: { id: string; siteId: string };
let studyB: { id: string; siteId: string };
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

  const a = await createTestStudy(owner.db);
  const b = await createTestStudy(owner.db);
  studyA = { id: a.study.id, siteId: a.site.id };
  studyB = { id: b.study.id, siteId: b.site.id };
  await grantTestRole(owner.db, tech.id, studyA.id, "technician", admin.id);
  await grantTestRole(owner.db, tech.id, studyB.id, "technician", admin.id);
  await grantTestRole(owner.db, monitor.id, studyA.id, "monitor", admin.id);
});

afterAll(async () => {
  await server.close();
});

describe("bulk accessioning", () => {
  it("creates N samples, each with custody opened", async () => {
    const token = await login(tech.username);
    const res = await server.inject({
      method: "POST",
      url: `/studies/${studyA.id}/samples/bulk`,
      headers: auth(token),
      payload: { siteId: studyA.siteId, sampleType: "serum", count: 5 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.count).toBe(5);
    expect(body.samples).toHaveLength(5);

    const detail = await server.inject({
      url: `/samples/${body.samples[0].id}`,
      headers: auth(token),
    });
    const custodyTypes = detail.json().custody.map((c: { eventType: string }) => c.eventType);
    expect(custodyTypes).toContain("receipt");
  });

  it("fills a box sequentially from the first free position", async () => {
    const token = await login(tech.username);
    const box = await createTestBox(owner.db, 2, 2);
    const res = await server.inject({
      method: "POST",
      url: `/studies/${studyA.id}/samples/bulk`,
      headers: auth(token),
      payload: { siteId: studyA.siteId, sampleType: "serum", count: 3, storageUnitId: box.id },
    });
    expect(res.statusCode).toBe(201);

    const map = await server.inject({
      url: `/studies/${studyA.id}/storage-units/${box.id}/map`,
      headers: auth(token),
    });
    const positions = map
      .json()
      .occupants.map((o: { position: string }) => o.position)
      .sort();
    expect(positions).toEqual(["A1", "A2", "B1"]);
  });

  it("rejects a batch larger than the box's free capacity", async () => {
    const token = await login(tech.username);
    const box = await createTestBox(owner.db, 2, 2);
    const res = await server.inject({
      method: "POST",
      url: `/studies/${studyA.id}/samples/bulk`,
      headers: auth(token),
      payload: { siteId: studyA.siteId, sampleType: "serum", count: 5, storageUnitId: box.id },
    });
    expect(res.statusCode).toBe(409);

    // Nothing was stored — the transaction rolled back.
    const map = await server.inject({
      url: `/studies/${studyA.id}/storage-units/${box.id}/map`,
      headers: auth(token),
    });
    expect(map.json().occupants).toHaveLength(0);
  });

  it("denies bulk accession without sample.accession", async () => {
    const token = await login(monitor.username);
    const res = await server.inject({
      method: "POST",
      url: `/studies/${studyA.id}/samples/bulk`,
      headers: auth(token),
      payload: { siteId: studyA.siteId, sampleType: "serum", count: 2 },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("freezer map (study-scoped visibility)", () => {
  it("shows this study's occupants but only positions for another study's", async () => {
    const token = await login(tech.username);
    const box = await createTestBox(owner.db, 2, 2);

    // Study A fills A1; study B fills the next free position in the shared box.
    await server.inject({
      method: "POST",
      url: `/studies/${studyA.id}/samples/bulk`,
      headers: auth(token),
      payload: { siteId: studyA.siteId, sampleType: "serum", count: 1, storageUnitId: box.id },
    });
    await server.inject({
      method: "POST",
      url: `/studies/${studyB.id}/samples/bulk`,
      headers: auth(token),
      payload: { siteId: studyB.siteId, sampleType: "serum", count: 1, storageUnitId: box.id },
    });

    const map = (
      await server.inject({
        url: `/studies/${studyA.id}/storage-units/${box.id}/map`,
        headers: auth(token),
      })
    ).json();
    expect(map.occupants).toHaveLength(1);
    expect(map.occupants[0].position).toBe("A1");
    expect(map.occupants[0].accessionId).toBeTruthy();
    // Study B's sample is visible only as an occupied position, no id leaked.
    expect(map.othersOccupiedPositions).toEqual(["A2"]);
  });
});
