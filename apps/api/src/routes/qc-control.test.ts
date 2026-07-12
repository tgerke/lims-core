import { evaluateControl } from "@lims-core/core";
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
 * QC control samples (ADR-0019): a control material catalog with an established
 * mean/SD, and control measurements recorded on a run and evaluated at entry
 * with single-point Westgard rules (1-2s warning / 1-3s reject).
 */

describe("evaluateControl() — single-point Westgard verdict (ADR-0019)", () => {
  it("accepts a value within 2 SD of the mean", () => {
    expect(evaluateControl(100, 5, 100)).toEqual({ zScore: 0, verdict: "accept" });
    expect(evaluateControl(100, 5, 109).verdict).toBe("accept"); // z = 1.8
  });
  it("warns (1-2s) beyond 2 SD but within 3 SD", () => {
    expect(evaluateControl(100, 5, 111).verdict).toBe("warning"); // z = 2.2
    expect(evaluateControl(100, 5, 89).verdict).toBe("warning"); // z = -2.2
  });
  it("rejects (1-3s) beyond 3 SD", () => {
    expect(evaluateControl(100, 5, 116).verdict).toBe("reject"); // z = 3.2
    expect(evaluateControl(100, 5, 84).verdict).toBe("reject"); // z = -3.2
  });
  it("treats the 2 SD and 3 SD boundaries as within the tighter band (strict >)", () => {
    expect(evaluateControl(100, 5, 110).verdict).toBe("accept"); // z = 2.0 exactly
    expect(evaluateControl(100, 5, 115).verdict).toBe("warning"); // z = 3.0 exactly
  });
});

let server: FastifyInstance;
let owner: ReturnType<typeof createDb>;
let studyId: string;
let siteId: string;
let manager: { id: string; username: string };
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

async function makeControl(
  token: string,
  serviceId: string,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: `/analysis-services/${serviceId}/control-materials`,
    headers: auth(token),
    payload: { level: "normal", lotNumber: `CTL-${uniqueSuffix()}`, ...body },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id;
}

async function makeWorksheet(token: string): Promise<string> {
  const sample = await server.inject({
    method: "POST",
    url: `/studies/${studyId}/samples`,
    headers: auth(token),
    payload: { siteId, sampleType: "serum" },
  });
  const order = await server.inject({
    method: "POST",
    url: `/samples/${sample.json().id}/orders`,
    headers: auth(token),
    payload: { serviceId: (await createTestService(owner.db)).id },
  });
  const ws = await server.inject({
    method: "POST",
    url: `/studies/${studyId}/worksheets`,
    headers: auth(token),
    payload: { requestIds: [order.json().id] },
  });
  expect(ws.statusCode).toBe(201);
  return ws.json().id;
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
  manager = await createTestUser(owner.db, { username: `mgr-${suffix}` });
  tech = await createTestUser(owner.db, { username: `tech-${suffix}` });
  monitor = await createTestUser(owner.db, { username: `mon-${suffix}` });

  const created = await createTestStudy(owner.db);
  studyId = created.study.id;
  siteId = created.site.id;
  await grantTestRole(owner.db, manager.id, studyId, "lab_manager", admin.id);
  await grantTestRole(owner.db, tech.id, studyId, "technician", admin.id);
  await grantTestRole(owner.db, monitor.id, studyId, "monitor", admin.id);
});

afterAll(async () => {
  await server.close();
});

describe("QC control measurements on a run (ADR-0019)", () => {
  it("records a measurement and freezes its z-score and Westgard verdict", async () => {
    const mgrToken = await login(manager.username);
    const techToken = await login(tech.username);
    const service = await createTestService(owner.db);
    const controlId = await makeControl(mgrToken, service.id, { targetMean: 100, targetSd: 5 });
    const worksheetId = await makeWorksheet(techToken);

    const accept = await server.inject({
      method: "POST",
      url: `/worksheets/${worksheetId}/qc-measurements`,
      headers: auth(techToken),
      payload: { controlMaterialId: controlId, value: 102 },
    });
    expect(accept.statusCode).toBe(201);
    expect(accept.json().verdict).toBe("accept");
    expect(Number(accept.json().zScore)).toBeCloseTo(0.4);

    const reject = await server.inject({
      method: "POST",
      url: `/worksheets/${worksheetId}/qc-measurements`,
      headers: auth(techToken),
      payload: { controlMaterialId: controlId, value: 120 },
    });
    expect(reject.json().verdict).toBe("reject");

    const detail = await server.inject({
      url: `/worksheets/${worksheetId}`,
      headers: auth(techToken),
    });
    expect(detail.json().qcMeasurements).toHaveLength(2);
  });

  it("supersedes a control material, retaining the prior row", async () => {
    const token = await login(manager.username);
    const service = await createTestService(owner.db);
    await makeControl(token, service.id, { targetMean: 100, targetSd: 5 });
    await makeControl(token, service.id, { targetMean: 200, targetSd: 10 });

    const list = await server.inject({
      url: `/analysis-services/${service.id}/control-materials`,
      headers: auth(token),
    });
    const rows = list.json() as { active: boolean; targetMean: string }[];
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.active)).toHaveLength(1);

    // A new measurement evaluates against the active (mean 200) target.
    const techToken = await login(tech.username);
    const active = (await server
      .inject({
        url: "/control-materials",
        headers: auth(techToken),
      })
      .then((r) => r.json())) as { id: string; serviceId: string }[];
    const controlId = active.find((c) => c.serviceId === service.id)?.id;
    const worksheetId = await makeWorksheet(techToken);
    const m = await server.inject({
      method: "POST",
      url: `/worksheets/${worksheetId}/qc-measurements`,
      headers: auth(techToken),
      payload: { controlMaterialId: controlId, value: 205 },
    });
    expect(m.json().verdict).toBe("accept"); // z = 0.5 against mean 200
  });

  it("rejects a control material with a non-positive SD", async () => {
    const token = await login(manager.username);
    const service = await createTestService(owner.db);
    const bad = await server.inject({
      method: "POST",
      url: `/analysis-services/${service.id}/control-materials`,
      headers: auth(token),
      payload: { level: "normal", lotNumber: "CTL-BAD", targetMean: 100, targetSd: 0 },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("blocks recording QC on a completed run", async () => {
    const mgrToken = await login(manager.username);
    const techToken = await login(tech.username);
    const service = await createTestService(owner.db);
    const controlId = await makeControl(mgrToken, service.id, { targetMean: 100, targetSd: 5 });
    const worksheetId = await makeWorksheet(techToken);
    await server.inject({
      method: "POST",
      url: `/worksheets/${worksheetId}/start`,
      headers: auth(techToken),
    });
    await server.inject({
      method: "POST",
      url: `/worksheets/${worksheetId}/complete`,
      headers: auth(techToken),
    });
    const denied = await server.inject({
      method: "POST",
      url: `/worksheets/${worksheetId}/qc-measurements`,
      headers: auth(techToken),
      payload: { controlMaterialId: controlId, value: 100 },
    });
    expect(denied.statusCode).toBe(409);
  });

  it("requires spec.manage to define a control material", async () => {
    const techToken = await login(tech.username);
    const service = await createTestService(owner.db);
    const denied = await server.inject({
      method: "POST",
      url: `/analysis-services/${service.id}/control-materials`,
      headers: auth(techToken),
      payload: { level: "normal", lotNumber: "CTL-X", targetMean: 100, targetSd: 5 },
    });
    expect(denied.statusCode).toBe(403);
  });

  it("requires worksheet.manage to record a QC measurement", async () => {
    const mgrToken = await login(manager.username);
    const techToken = await login(tech.username);
    const monitorToken = await login(monitor.username);
    const service = await createTestService(owner.db);
    const controlId = await makeControl(mgrToken, service.id, { targetMean: 100, targetSd: 5 });
    const worksheetId = await makeWorksheet(techToken);
    const denied = await server.inject({
      method: "POST",
      url: `/worksheets/${worksheetId}/qc-measurements`,
      headers: auth(monitorToken),
      payload: { controlMaterialId: controlId, value: 100 },
    });
    expect(denied.statusCode).toBe(403);
  });
});
