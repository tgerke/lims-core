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
 * Freeze-thaw counts and concentration (ADR-0013): bench-handling operations that
 * increment the count / set concentration, are gated on sample.aliquot, and are
 * locked once a sample is disposed or on hold.
 */

let server: FastifyInstance;
let owner: ReturnType<typeof createDb>;

let studyId: string;
let siteId: string;
let tech: { id: string; username: string };
let accessioner: { id: string; username: string };
let manager: { id: string; username: string };

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
    payload: { siteId, sampleType: "dna", subjectKey: `SUBJ-${uniqueSuffix()}` },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id;
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
  accessioner = await createTestUser(owner.db, { username: `acc-${suffix}` });
  manager = await createTestUser(owner.db, { username: `mgr-${suffix}` });

  const created = await createTestStudy(owner.db);
  studyId = created.study.id;
  siteId = created.site.id;
  await grantTestRole(owner.db, tech.id, studyId, "technician", admin.id);
  await grantTestRole(owner.db, accessioner.id, studyId, "accessioner", admin.id);
  await grantTestRole(owner.db, manager.id, studyId, "lab_manager", admin.id);
});

afterAll(async () => {
  await server.close();
});

describe("freeze-thaw and concentration (ADR-0013)", () => {
  it("increments the freeze-thaw count and sets concentration", async () => {
    const token = await login(tech.username);
    const id = await accession(token);

    await server.inject({
      method: "POST",
      url: `/samples/${id}/freeze-thaw`,
      headers: auth(token),
    });
    await server.inject({
      method: "POST",
      url: `/samples/${id}/freeze-thaw`,
      headers: auth(token),
    });
    const conc = await server.inject({
      method: "POST",
      url: `/samples/${id}/concentration`,
      headers: auth(token),
      payload: { concentration: 25.4, unit: "ng/µL" },
    });
    expect(conc.statusCode).toBe(200);

    const body = (await detail(token, id)).json();
    expect(body.freezeThawCount).toBe(2);
    expect(Number(body.concentration)).toBe(25.4);
    expect(body.concentrationUnit).toBe("ng/µL");
  });

  it("locks measurements once a sample is on hold", async () => {
    const token = await login(tech.username);
    const managerToken = await login(manager.username);
    const id = await accession(token);
    const held = await server.inject({
      method: "POST",
      url: `/studies/${studyId}/holds`,
      headers: auth(managerToken),
      payload: { sampleId: id, reason: "quarantine" },
    });
    expect(held.statusCode).toBe(201);

    const ft = await server.inject({
      method: "POST",
      url: `/samples/${id}/freeze-thaw`,
      headers: auth(token),
    });
    expect(ft.statusCode).toBe(409);
  });

  it("requires sample.aliquot", async () => {
    const token = await login(tech.username);
    const id = await accession(token);
    // Accessioner holds sample.accession/store but not sample.aliquot.
    const accToken = await login(accessioner.username);
    const denied = await server.inject({
      method: "POST",
      url: `/samples/${id}/freeze-thaw`,
      headers: auth(accToken),
    });
    expect(denied.statusCode).toBe(403);
  });
});
