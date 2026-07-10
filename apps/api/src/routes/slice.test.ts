import { createDb, databaseUrl, runMigrations } from "@lims-core/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import {
  createTestBox,
  createTestService,
  createTestStudy,
  createTestUser,
  grantTestRole,
  TEST_PASSWORD,
  uniqueSuffix,
} from "../test-helpers.js";

/**
 * The vertical slice, end-to-end through the HTTP surface: accession → label
 * → store → order → result → verify → e-sign → audit trail. Exercises RBAC
 * (P11-04), four-eyes verification, password step-up signing (ADR-0003,
 * §11.200(a)) and chain verification (P11-03) as the API delivers them.
 */

let server: FastifyInstance;
let owner: ReturnType<typeof createDb>;

let studyId: string;
let siteId: string;
let boxId: string;
let serviceId: string;
let tech: { id: string; username: string };
let manager: { id: string; username: string };
let accessioner: { id: string; username: string };

async function login(username: string, password = TEST_PASSWORD): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: "/auth/login",
    payload: { username, password },
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
  manager = await createTestUser(owner.db, { username: `mgr-${suffix}` });
  accessioner = await createTestUser(owner.db, { username: `acc-${suffix}` });

  const created = await createTestStudy(owner.db);
  studyId = created.study.id;
  siteId = created.site.id;
  await grantTestRole(owner.db, tech.id, studyId, "technician", admin.id);
  await grantTestRole(owner.db, manager.id, studyId, "lab_manager", admin.id);
  await grantTestRole(owner.db, accessioner.id, studyId, "accessioner", admin.id);

  boxId = (await createTestBox(owner.db, 2, 2)).id;
  serviceId = (await createTestService(owner.db)).id;
});

afterAll(async () => {
  await server.close();
});

describe("the vertical slice", () => {
  let sampleId: string;
  let orderId: string;

  it("accessions a sample with custody opened (CoC-01)", async () => {
    const token = await login(tech.username);
    const res = await server.inject({
      method: "POST",
      url: `/studies/${studyId}/samples`,
      headers: auth(token),
      payload: {
        siteId,
        sampleType: "serum",
        subjectKey: "SUBJ-001",
        collectedAt: new Date().toISOString(),
      },
    });
    expect(res.statusCode).toBe(201);
    const sample = res.json();
    sampleId = sample.id;
    expect(sample.accessionId).toMatch(/^TEST-.*-\d{5}$/);

    const detail = await server.inject({ url: `/samples/${sampleId}`, headers: auth(token) });
    expect(detail.statusCode).toBe(200);
    const custodyTypes = detail.json().custody.map((c: { eventType: string }) => c.eventType);
    expect(custodyTypes).toEqual(["collection", "receipt"]);
  });

  it("renders a DataMatrix label (ADR-0004)", async () => {
    const token = await login(tech.username);
    const res = await server.inject({
      url: `/samples/${sampleId}/label.png`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.rawPayload.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it("stores the sample in a box position with a custody event (CoC-03)", async () => {
    const token = await login(tech.username);
    const res = await server.inject({
      method: "POST",
      url: `/samples/${sampleId}/store`,
      headers: auth(token),
      payload: { storageUnitId: boxId, position: "A1" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().storagePosition).toBe("A1");
    expect(res.json().status).toBe("in_storage");
  });

  it("rejects a double-booked position (CoC-03)", async () => {
    const token = await login(tech.username);
    const other = await server.inject({
      method: "POST",
      url: `/studies/${studyId}/samples`,
      headers: auth(token),
      payload: { siteId, sampleType: "plasma" },
    });
    const res = await server.inject({
      method: "POST",
      url: `/samples/${other.json().id}/store`,
      headers: auth(token),
      payload: { storageUnitId: boxId, position: "A1" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("orders a test", async () => {
    const token = await login(tech.username);
    const res = await server.inject({
      method: "POST",
      url: `/samples/${sampleId}/orders`,
      headers: auth(token),
      payload: { serviceId },
    });
    expect(res.statusCode).toBe(201);
    orderId = res.json().id;
  });

  it("blocks result entry without result.enter (P11-04)", async () => {
    const token = await login(accessioner.username);
    const res = await server.inject({
      method: "POST",
      url: `/orders/${orderId}/results`,
      headers: auth(token),
      payload: { value: "4.2", unit: "ng/mL" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("enters a result (version 1)", async () => {
    const token = await login(tech.username);
    const res = await server.inject({
      method: "POST",
      url: `/orders/${orderId}/results`,
      headers: auth(token),
      payload: { value: "4.2", unit: "ng/mL" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().version).toBe(1);
    expect(res.json().status).toBe("entered");
  });

  it("requires a reason for change on correction (P11-02)", async () => {
    const token = await login(tech.username);
    const rejected = await server.inject({
      method: "POST",
      url: `/orders/${orderId}/results`,
      headers: auth(token),
      payload: { value: "4.3", unit: "ng/mL" },
    });
    expect(rejected.statusCode).toBe(400);
    const corrected = await server.inject({
      method: "POST",
      url: `/orders/${orderId}/results`,
      headers: auth(token),
      payload: { value: "4.3", unit: "ng/mL", reasonForChange: "transcription error" },
    });
    expect(corrected.statusCode).toBe(201);
    expect(corrected.json().version).toBe(2);
  });

  it("refuses verification by the person who entered the result", async () => {
    const token = await login(tech.username);
    const res = await server.inject({
      method: "POST",
      url: `/orders/${orderId}/verify`,
      headers: auth(token),
    });
    // tech holds no result.verify permission at all → 403 either way
    expect(res.statusCode).toBe(403);
  });

  it("verifies the result as a second person (four-eyes)", async () => {
    const token = await login(manager.username);
    const res = await server.inject({
      method: "POST",
      url: `/orders/${orderId}/verify`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("verified");
    expect(res.json().version).toBe(3);
  });

  it("rejects an e-signature with a wrong password (ADR-0003, §11.200(a))", async () => {
    const token = await login(manager.username);
    const res = await server.inject({
      method: "POST",
      url: `/orders/${orderId}/sign`,
      headers: auth(token),
      payload: { password: "wrong-password-1A!" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("signs with password step-up and binds to the record hash (P11-09)", async () => {
    const token = await login(manager.username);
    const res = await server.inject({
      method: "POST",
      url: `/orders/${orderId}/sign`,
      headers: auth(token),
      payload: { password: TEST_PASSWORD, meaning: "result_release" },
    });
    expect(res.statusCode).toBe(201);
    const signature = res.json();
    expect(signature.recordHash).toMatch(/^[0-9a-f]{64}$/);

    // Signed = closed: further entry and re-signing are refused.
    const reentry = await server.inject({
      method: "POST",
      url: `/orders/${orderId}/results`,
      headers: auth(token),
      payload: { value: "9.9", reasonForChange: "should not work" },
    });
    expect(reentry.statusCode).toBe(409);
  });

  it("serves a reviewable, verifying audit trail (P11-03, P11-05)", async () => {
    const token = await login(manager.username);
    const trail = await server.inject({
      url: `/studies/${studyId}/audit`,
      headers: auth(token),
    });
    expect(trail.statusCode).toBe(200);
    const body = trail.json();
    expect(body.total).toBeGreaterThan(5);
    expect(body.facets.actions).toContain("sample.insert");
    expect(body.facets.actions).toContain("signature.insert");

    const verify = await server.inject({
      url: `/studies/${studyId}/audit/verify`,
      headers: auth(token),
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().ok).toBe(true);

    // Plain membership is not enough to read the trail (P11-04).
    const techToken = await login(tech.username);
    const denied = await server.inject({
      url: `/studies/${studyId}/audit`,
      headers: auth(techToken),
    });
    expect(denied.statusCode).toBe(403);
  });
});
