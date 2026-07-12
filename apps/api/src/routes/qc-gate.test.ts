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
 * Run-level QC gate (ADR-0021): a rejecting control on a worksheet puts the run
 * out of control; verifying/signing results for that run's orders is blocked
 * until the failing control is re-run within limits.
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

async function resultedOrderOnRun(
  mgrToken: string,
  techToken: string,
): Promise<{ orderId: string; worksheetId: string; controlId: string }> {
  const service = await createTestService(owner.db);
  // A control for a *different* service so its measurement doesn't affect the order's spec.
  const controlService = await createTestService(owner.db);
  const control = await server.inject({
    method: "POST",
    url: `/analysis-services/${controlService.id}/control-materials`,
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
  const orderId = order.json().id;
  await server.inject({
    method: "POST",
    url: `/orders/${orderId}/results`,
    headers: auth(techToken),
    payload: { value: "3.0" },
  });

  const ws = await server.inject({
    method: "POST",
    url: `/studies/${studyId}/worksheets`,
    headers: auth(techToken),
    payload: { requestIds: [orderId] },
  });
  return { orderId, worksheetId: ws.json().id, controlId };
}

async function recordQc(token: string, worksheetId: string, controlId: string, value: number) {
  return server.inject({
    method: "POST",
    url: `/worksheets/${worksheetId}/qc-measurements`,
    headers: auth(token),
    payload: { controlMaterialId: controlId, value },
  });
}

const verify = (token: string, orderId: string) =>
  server.inject({ method: "POST", url: `/orders/${orderId}/verify`, headers: auth(token) });

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

describe("run-level QC gate (ADR-0021)", () => {
  it("blocks verification while a control on the run is rejecting", async () => {
    const mgrToken = await login(manager.username);
    const techToken = await login(tech.username);
    const { orderId, worksheetId, controlId } = await resultedOrderOnRun(mgrToken, techToken);

    // z = (130 - 100) / 5 = 6 -> reject
    expect((await recordQc(techToken, worksheetId, controlId, 130)).json().verdict).toBe("reject");

    // Manager verifies (four-eyes: entered by tech), but the run is out of control.
    const blocked = await verify(mgrToken, orderId);
    expect(blocked.statusCode).toBe(409);

    const detail = await server.inject({
      url: `/worksheets/${worksheetId}`,
      headers: auth(techToken),
    });
    expect(detail.json().controlStatus).toBe("out_of_control");
  });

  it("allows verification once the control is re-run within limits", async () => {
    const mgrToken = await login(manager.username);
    const techToken = await login(tech.username);
    const { orderId, worksheetId, controlId } = await resultedOrderOnRun(mgrToken, techToken);

    await recordQc(techToken, worksheetId, controlId, 130); // reject
    expect((await verify(mgrToken, orderId)).statusCode).toBe(409);

    // Re-run the control in range: z = (101 - 100)/5 = 0.2 -> accept. Latest verdict governs.
    expect((await recordQc(techToken, worksheetId, controlId, 101)).json().verdict).toBe("accept");

    const ok = await verify(mgrToken, orderId);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe("verified");
  });

  it("does not gate a run with no QC or only a warning", async () => {
    const mgrToken = await login(manager.username);
    const techToken = await login(tech.username);
    const { orderId, worksheetId, controlId } = await resultedOrderOnRun(mgrToken, techToken);

    // z = (111 - 100)/5 = 2.2 -> warning, which does not gate.
    expect((await recordQc(techToken, worksheetId, controlId, 111)).json().verdict).toBe("warning");
    expect((await verify(mgrToken, orderId)).statusCode).toBe(200);
  });
});
