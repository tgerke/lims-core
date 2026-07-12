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
 * QC review (ADR-0024): read-only board of active controls and the
 * Levey-Jennings series for one control material. The endpoints report the
 * frozen verdict/rule/z-score the Westgard evaluation (ADR-0019/0023) already
 * recorded; this test drives a known sequence and asserts the reads reflect it.
 */

let server: FastifyInstance;
let owner: ReturnType<typeof createDb>;
let studyId: string;
let siteId: string;
let manager: { id: string; username: string };
let tech: { id: string; username: string };

async function login(username: string): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: "/auth/login",
    payload: { username, password: TEST_PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { token: string }).token;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

// An open (draft) worksheet plus a control material for its own service, ready
// to take QC measurements.
async function openRunWithControl(
  mgrToken: string,
  techToken: string,
): Promise<{ worksheetId: string; controlId: string }> {
  const service = await createTestService(owner.db);
  const control = await server.inject({
    method: "POST",
    url: `/analysis-services/${service.id}/control-materials`,
    headers: auth(mgrToken),
    payload: { level: "normal", lotNumber: `CTL-${uniqueSuffix()}`, targetMean: 100, targetSd: 5 },
  });
  const controlId = control.json().id;

  const sample = await server.inject({
    method: "POST",
    url: `/studies/${studyId}/samples`,
    headers: auth(techToken),
    payload: { siteId, sampleType: "serum" },
  });
  const order = await server.inject({
    method: "POST",
    url: `/samples/${sample.json().id}/orders`,
    headers: auth(techToken),
    payload: { serviceId: service.id },
  });
  const ws = await server.inject({
    method: "POST",
    url: `/studies/${studyId}/worksheets`,
    headers: auth(techToken),
    payload: { requestIds: [order.json().id] },
  });
  return { worksheetId: ws.json().id, controlId };
}

async function recordQc(token: string, worksheetId: string, controlId: string, value: number) {
  return server.inject({
    method: "POST",
    url: `/worksheets/${worksheetId}/qc-measurements`,
    headers: auth(token),
    payload: { controlMaterialId: controlId, value },
  });
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

  const created = await createTestStudy(owner.db);
  studyId = created.study.id;
  siteId = created.site.id;
  await grantTestRole(owner.db, manager.id, studyId, "lab_manager", admin.id);
  await grantTestRole(owner.db, tech.id, studyId, "technician", admin.id);
});

afterAll(async () => {
  await server.close();
});

describe("QC review (ADR-0024)", () => {
  it("returns the control series oldest-first with frozen z-scores and rules", async () => {
    const mgrToken = await login(manager.username);
    const techToken = await login(tech.username);
    const { worksheetId, controlId } = await openRunWithControl(mgrToken, techToken);

    // z = (111-100)/5 = 2.2 -> 1-2s warning; then (112-100)/5 = 2.4 completes a
    // same-side 2-2s -> reject (ADR-0023).
    await recordQc(techToken, worksheetId, controlId, 111);
    await recordQc(techToken, worksheetId, controlId, 112);

    const res = await server.inject({
      url: `/control-materials/${controlId}/series`,
      headers: auth(techToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.control.targetMean).toBe("100");
    expect(body.points).toHaveLength(2);
    // Chronological: warning first, then the rejecting 2-2s.
    expect(body.points[0]).toMatchObject({ verdict: "warning", rule: "1-2s" });
    expect(Number(body.points[0].zScore)).toBeCloseTo(2.2, 5);
    expect(body.points[1]).toMatchObject({ verdict: "reject", rule: "2-2s" });
  });

  it("summarizes each active control by its latest verdict and count", async () => {
    const mgrToken = await login(manager.username);
    const techToken = await login(tech.username);
    const { worksheetId, controlId } = await openRunWithControl(mgrToken, techToken);

    await recordQc(techToken, worksheetId, controlId, 111); // warning
    await recordQc(techToken, worksheetId, controlId, 130); // z=6 -> reject

    const res = await server.inject({ url: "/qc-review", headers: auth(techToken) });
    expect(res.statusCode).toBe(200);
    const row = res
      .json()
      .find((r: { controlMaterialId: string }) => r.controlMaterialId === controlId);
    expect(row).toBeDefined();
    expect(row.n).toBe(2);
    // Latest governs: the second measurement rejected.
    expect(row.latestVerdict).toBe("reject");
    expect(Number(row.latestZ)).toBeCloseTo(6, 5);
  });

  it("shows an active control with no measurements as null-latest", async () => {
    const mgrToken = await login(manager.username);
    const service = await createTestService(owner.db);
    const control = await server.inject({
      method: "POST",
      url: `/analysis-services/${service.id}/control-materials`,
      headers: auth(mgrToken),
      payload: { level: "low", lotNumber: `CTL-${uniqueSuffix()}`, targetMean: 50, targetSd: 2 },
    });
    const controlId = control.json().id;

    const res = await server.inject({ url: "/qc-review", headers: auth(mgrToken) });
    const row = res
      .json()
      .find((r: { controlMaterialId: string }) => r.controlMaterialId === controlId);
    expect(row).toMatchObject({ n: 0, latestVerdict: null, latestZ: null, latestAt: null });
  });

  it("404s an unknown control material series", async () => {
    const techToken = await login(tech.username);
    const res = await server.inject({
      url: "/control-materials/00000000-0000-0000-0000-000000000000/series",
      headers: auth(techToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it("requires authentication", async () => {
    const res = await server.inject({ url: "/qc-review" });
    expect(res.statusCode).toBe(401);
  });
});
