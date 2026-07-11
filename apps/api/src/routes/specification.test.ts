import { evaluate } from "@lims-core/core";
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
 * Analytical/QC first slice (ADR-0017): acceptance criteria per service,
 * evaluated automatically at result entry into a pass / out_of_spec /
 * not_evaluated flag.
 */

describe("evaluate() — spec verdict (ADR-0017)", () => {
  it("passes a numeric value inside inclusive bounds", () => {
    const spec = { lowerLimit: "1", upperLimit: "5", expectedValue: null };
    expect(evaluate(spec, "1")).toBe("pass");
    expect(evaluate(spec, "5")).toBe("pass");
    expect(evaluate(spec, "3.2")).toBe("pass");
  });
  it("fails a numeric value outside bounds", () => {
    const spec = { lowerLimit: "1", upperLimit: "5", expectedValue: null };
    expect(evaluate(spec, "0.9")).toBe("out_of_spec");
    expect(evaluate(spec, "5.1")).toBe("out_of_spec");
  });
  it("honors open-ended bounds", () => {
    expect(evaluate({ lowerLimit: "10", upperLimit: null, expectedValue: null }, "999")).toBe(
      "pass",
    );
    expect(evaluate({ lowerLimit: "10", upperLimit: null, expectedValue: null }, "9")).toBe(
      "out_of_spec",
    );
  });
  it("matches a qualitative expected value case-insensitively", () => {
    const spec = { lowerLimit: null, upperLimit: null, expectedValue: "Negative" };
    expect(evaluate(spec, "negative")).toBe("pass");
    expect(evaluate(spec, "positive")).toBe("out_of_spec");
  });
  it("does not evaluate when there is no spec or the value is non-numeric", () => {
    expect(evaluate(null, "4.2")).toBe("not_evaluated");
    expect(evaluate({ lowerLimit: "1", upperLimit: "5", expectedValue: null }, "n/a")).toBe(
      "not_evaluated",
    );
  });
});

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

async function orderAndEnter(token: string, sampleId: string, serviceId: string, value: string) {
  const ordered = await server.inject({
    method: "POST",
    url: `/samples/${sampleId}/orders`,
    headers: auth(token),
    payload: { serviceId },
  });
  expect(ordered.statusCode).toBe(201);
  const entered = await server.inject({
    method: "POST",
    url: `/orders/${ordered.json().id}/results`,
    headers: auth(token),
    payload: { value },
  });
  expect(entered.statusCode).toBe(201);
  return entered.json();
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

describe("spec evaluation at result entry (ADR-0017)", () => {
  it("flags in-range as pass and out-of-range as out_of_spec", async () => {
    const token = await login(manager.username);
    const service = await createTestService(owner.db);
    const spec = await server.inject({
      method: "POST",
      url: `/analysis-services/${service.id}/specifications`,
      headers: auth(token),
      payload: { lowerLimit: 1, upperLimit: 5, unit: "ng/mL" },
    });
    expect(spec.statusCode).toBe(201);

    const passing = await orderAndEnter(token, await accession(token), service.id, "4.2");
    expect(passing.qcStatus).toBe("pass");
    const failing = await orderAndEnter(token, await accession(token), service.id, "9.9");
    expect(failing.qcStatus).toBe("out_of_spec");
  });

  it("leaves a result not_evaluated when the service has no spec", async () => {
    const token = await login(manager.username);
    const service = await createTestService(owner.db);
    const result = await orderAndEnter(token, await accession(token), service.id, "4.2");
    expect(result.qcStatus).toBe("not_evaluated");
  });

  it("supersedes a spec, retaining the prior row, and evaluates against the new one", async () => {
    const token = await login(manager.username);
    const service = await createTestService(owner.db);
    for (const limits of [
      { lowerLimit: 1, upperLimit: 5 },
      { lowerLimit: 100, upperLimit: 200 },
    ]) {
      const res = await server.inject({
        method: "POST",
        url: `/analysis-services/${service.id}/specifications`,
        headers: auth(token),
        payload: limits,
      });
      expect(res.statusCode).toBe(201);
    }

    const specs = await server.inject({
      url: `/analysis-services/${service.id}/specifications`,
      headers: auth(token),
    });
    const rows = specs.json() as { active: boolean }[];
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.active)).toHaveLength(1);

    // 150 passes the new [100,200] range; 4.2 (fine under the old spec) now fails.
    expect((await orderAndEnter(token, await accession(token), service.id, "150")).qcStatus).toBe(
      "pass",
    );
    expect((await orderAndEnter(token, await accession(token), service.id, "4.2")).qcStatus).toBe(
      "out_of_spec",
    );
  });

  it("requires spec.manage to set a spec", async () => {
    const techToken = await login(tech.username);
    const service = await createTestService(owner.db);
    const denied = await server.inject({
      method: "POST",
      url: `/analysis-services/${service.id}/specifications`,
      headers: auth(techToken),
      payload: { lowerLimit: 1, upperLimit: 5 },
    });
    expect(denied.statusCode).toBe(403);
  });
});
