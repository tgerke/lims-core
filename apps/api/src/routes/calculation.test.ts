import { evaluateExpression } from "@lims-core/core";
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
 * Calculated results (ADR-0020): a service's formula over other analytes on the
 * same sample, evaluated by a safe expression parser and appended as a
 * `calculated` result version, spec-evaluated like a measured one.
 */

describe("evaluateExpression() — safe arithmetic (ADR-0020)", () => {
  it("evaluates arithmetic with precedence and parentheses", () => {
    expect(evaluateExpression("1 + 2 * 3", {})).toBe(7);
    expect(evaluateExpression("(1 + 2) * 3", {})).toBe(9);
    expect(evaluateExpression("-4 + 10", {})).toBe(6);
    expect(evaluateExpression("2.5 * 4", {})).toBe(10);
  });
  it("binds variables and computes a ratio", () => {
    expect(evaluateExpression("free / total * 100", { free: 1, total: 4 })).toBe(25);
  });
  it("throws on an unknown variable", () => {
    expect(() => evaluateExpression("a + b", { a: 1 })).toThrow(/unknown variable/);
  });
  it("throws on division by zero", () => {
    expect(() => evaluateExpression("x / y", { x: 1, y: 0 })).toThrow(/division by zero/);
  });
  it("rejects malformed expressions and injection attempts", () => {
    expect(() => evaluateExpression("1 +", {})).toThrow();
    expect(() => evaluateExpression("(1 + 2", {})).toThrow(/unbalanced/);
    expect(() => evaluateExpression("process.exit(1)", {})).toThrow();
    expect(() => evaluateExpression("1; 2", {})).toThrow();
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

async function order(token: string, sampleId: string, serviceId: string): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: `/samples/${sampleId}/orders`,
    headers: auth(token),
    payload: { serviceId },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id;
}

async function enter(token: string, orderId: string, value: string) {
  const res = await server.inject({
    method: "POST",
    url: `/orders/${orderId}/results`,
    headers: auth(token),
    payload: { value },
  });
  expect(res.statusCode).toBe(201);
  return res.json();
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

describe("calculated results (ADR-0020)", () => {
  it("computes a calculated result from inputs on the same sample", async () => {
    const mgrToken = await login(manager.username);
    const techToken = await login(tech.username);
    const free = await createTestService(owner.db);
    const total = await createTestService(owner.db);
    const ratio = await createTestService(owner.db);

    // %free = free / total * 100
    const def = await server.inject({
      method: "POST",
      url: `/analysis-services/${ratio.id}/calculation`,
      headers: auth(mgrToken),
      payload: {
        expression: "free / total * 100",
        inputs: [
          { variable: "free", serviceId: free.id },
          { variable: "total", serviceId: total.id },
        ],
      },
    });
    expect(def.statusCode).toBe(201);

    const sampleId = await accession(techToken);
    await enter(techToken, await order(techToken, sampleId, free.id), "1");
    await enter(techToken, await order(techToken, sampleId, total.id), "4");
    const ratioOrder = await order(techToken, sampleId, ratio.id);

    const computed = await server.inject({
      method: "POST",
      url: `/orders/${ratioOrder}/calculate`,
      headers: auth(techToken),
    });
    expect(computed.statusCode).toBe(201);
    expect(computed.json().source).toBe("calculated");
    expect(Number(computed.json().value)).toBe(25);
  });

  it("refuses to compute before an input has a numeric result", async () => {
    const mgrToken = await login(manager.username);
    const techToken = await login(tech.username);
    const a = await createTestService(owner.db);
    const out = await createTestService(owner.db);
    await server.inject({
      method: "POST",
      url: `/analysis-services/${out.id}/calculation`,
      headers: auth(mgrToken),
      payload: { expression: "a * 2", inputs: [{ variable: "a", serviceId: a.id }] },
    });

    const sampleId = await accession(techToken);
    const outOrder = await order(techToken, sampleId, out.id); // input never resulted
    const early = await server.inject({
      method: "POST",
      url: `/orders/${outOrder}/calculate`,
      headers: auth(techToken),
    });
    expect(early.statusCode).toBe(409);
  });

  it("rejects a formula that references an undeclared variable", async () => {
    const mgrToken = await login(manager.username);
    const a = await createTestService(owner.db);
    const out = await createTestService(owner.db);
    const bad = await server.inject({
      method: "POST",
      url: `/analysis-services/${out.id}/calculation`,
      headers: auth(mgrToken),
      payload: { expression: "a + b", inputs: [{ variable: "a", serviceId: a.id }] },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("requires spec.manage to define a formula", async () => {
    const techToken = await login(tech.username);
    const a = await createTestService(owner.db);
    const out = await createTestService(owner.db);
    const denied = await server.inject({
      method: "POST",
      url: `/analysis-services/${out.id}/calculation`,
      headers: auth(techToken),
      payload: { expression: "a", inputs: [{ variable: "a", serviceId: a.id }] },
    });
    expect(denied.statusCode).toBe(403);
  });
});
