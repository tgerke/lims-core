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
 * Interactive freezer-map placement (ADR-0015): moveSample places or relocates a
 * sample to a specific cell, recording storage_remove at the old cell on a move.
 */

let server: FastifyInstance;
let owner: ReturnType<typeof createDb>;

let studyId: string;
let siteId: string;
let boxId: string;
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

async function accession(token: string): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: `/studies/${studyId}/samples`,
    headers: auth(token),
    payload: { siteId, sampleType: "serum" },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id;
}

function move(token: string, sampleId: string, position: string) {
  return server.inject({
    method: "POST",
    url: `/samples/${sampleId}/move`,
    headers: auth(token),
    payload: { storageUnitId: boxId, position },
  });
}

function detail(token: string, id: string) {
  return server.inject({ url: `/samples/${id}`, headers: auth(token) });
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

  boxId = (await createTestBox(owner.db, 3, 3)).id;
});

afterAll(async () => {
  await server.close();
});

function eventTypes(custody: { eventType: string }[]) {
  return custody.map((c) => c.eventType);
}

describe("interactive freezer-map placement (ADR-0015)", () => {
  it("places an unstored sample and then relocates it, recording removal", async () => {
    const token = await login(tech.username);
    const id = await accession(token);

    const placed = await move(token, id, "A1");
    expect(placed.statusCode).toBe(200);
    expect(placed.json().storagePosition).toBe("A1");

    const relocated = await move(token, id, "B2");
    expect(relocated.statusCode).toBe(200);
    expect(relocated.json().storagePosition).toBe("B2");

    const body = (await detail(token, id)).json();
    expect(body.storagePosition).toBe("B2");
    // storage_add (A1), storage_remove (A1), storage_add (B2).
    const types = eventTypes(body.custody);
    expect(types.filter((t) => t === "storage_add")).toHaveLength(2);
    expect(types).toContain("storage_remove");
  });

  it("rejects moving onto an occupied cell", async () => {
    const token = await login(tech.username);
    const a = await accession(token);
    const b = await accession(token);
    expect((await move(token, a, "C1")).statusCode).toBe(200);
    const collision = await move(token, b, "C1");
    expect(collision.statusCode).toBe(409);
  });

  it("requires sample.store", async () => {
    const token = await login(tech.username);
    const id = await accession(token);
    const monitorToken = await login(monitor.username);
    const denied = await move(monitorToken, id, "A2");
    expect(denied.statusCode).toBe(403);
  });
});
