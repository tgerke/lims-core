import { type CoaSnapshot, coaContentHash, formatCoaNumber } from "@lims-core/core";
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
 * Certificate of Analysis (ADR-0022): issue an immutable snapshot of a sample's
 * released results and render it to PDF.
 */

const sampleSnapshot = (): CoaSnapshot => ({
  study: { oid: "S-1", name: "Study One" },
  sample: { accessionId: "S-1-00001", sampleType: "serum", subjectKey: null },
  analytes: [
    {
      serviceCode: "PSA",
      serviceName: "PSA",
      value: "4.2",
      unit: "ng/mL",
      qcStatus: "pass",
      source: "measured",
      status: "signed",
      resultVersion: 3,
    },
  ],
  issuedBy: { username: "mgarcia", fullName: "Maria Garcia" },
  issuedAt: "2026-07-11T00:00:00.000Z",
});

describe("CoA pure helpers (ADR-0022)", () => {
  it("formats a per-study CoA number", () => {
    expect(formatCoaNumber("demo-001", 42)).toBe("DEMO-001-COA-00042");
  });
  it("hashes a snapshot stably regardless of key order", () => {
    const a = sampleSnapshot();
    const b: CoaSnapshot = {
      issuedAt: a.issuedAt,
      issuedBy: a.issuedBy,
      analytes: a.analytes,
      sample: a.sample,
      study: a.study,
    };
    expect(coaContentHash(a)).toBe(coaContentHash(b));
  });
  it("changes the hash when certified content changes", () => {
    const a = sampleSnapshot();
    const b = sampleSnapshot();
    b.analytes = b.analytes.map((x) => ({ ...x, value: "9.9" }));
    expect(coaContentHash(a)).not.toBe(coaContentHash(b));
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

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** A sample with one order carried all the way to a verified result. */
async function sampleWithVerifiedResult(mgrToken: string, techToken: string): Promise<string> {
  const service = await createTestService(owner.db);
  const sample = await server.inject({
    method: "POST",
    url: `/studies/${studyId}/samples`,
    headers: auth(techToken),
    payload: { siteId, sampleType: "serum" },
  });
  const sampleId = sample.json().id;
  const order = await server.inject({
    method: "POST",
    url: `/samples/${sampleId}/orders`,
    headers: auth(techToken),
    payload: { serviceId: service.id },
  });
  await server.inject({
    method: "POST",
    url: `/orders/${order.json().id}/results`,
    headers: auth(techToken),
    payload: { value: "4.2" },
  });
  const verified = await server.inject({
    method: "POST",
    url: `/orders/${order.json().id}/verify`,
    headers: auth(mgrToken),
  });
  expect(verified.statusCode).toBe(200);
  return sampleId;
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
  // lab_manager holds result.verify and result.sign in this project's role seed.
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

describe("Certificate of Analysis (ADR-0022)", () => {
  it("issues a CoA over released results and renders a PDF", async () => {
    const mgrToken = await login(manager.username);
    const techToken = await login(tech.username);
    const sampleId = await sampleWithVerifiedResult(mgrToken, techToken);

    const issued = await server.inject({
      method: "POST",
      url: `/samples/${sampleId}/certificates`,
      headers: auth(mgrToken),
    });
    expect(issued.statusCode).toBe(201);
    expect(issued.json().coaNumber).toMatch(/-COA-\d{5}$/);

    const pdf = await server.inject({
      url: `/certificates/${issued.json().id}/pdf`,
      headers: auth(techToken),
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("refuses to issue when the sample has no released results", async () => {
    const mgrToken = await login(manager.username);
    const techToken = await login(tech.username);
    const service = await createTestService(owner.db);
    const sample = await server.inject({
      method: "POST",
      url: `/studies/${studyId}/samples`,
      headers: auth(techToken),
      payload: { siteId, sampleType: "serum" },
    });
    // ordered + entered but not verified -> not released.
    const order = await server.inject({
      method: "POST",
      url: `/samples/${sample.json().id}/orders`,
      headers: auth(techToken),
      payload: { serviceId: service.id },
    });
    await server.inject({
      method: "POST",
      url: `/orders/${order.json().id}/results`,
      headers: auth(techToken),
      payload: { value: "4.2" },
    });
    const denied = await server.inject({
      method: "POST",
      url: `/samples/${sample.json().id}/certificates`,
      headers: auth(mgrToken),
    });
    expect(denied.statusCode).toBe(409);
  });

  it("requires result.sign to issue", async () => {
    const mgrToken = await login(manager.username);
    const techToken = await login(tech.username);
    const sampleId = await sampleWithVerifiedResult(mgrToken, techToken);
    const denied = await server.inject({
      method: "POST",
      url: `/samples/${sampleId}/certificates`,
      headers: auth(techToken), // technician lacks result.sign
    });
    expect(denied.statusCode).toBe(403);
  });

  it("is immutable at the database (append-only)", async () => {
    const mgrToken = await login(manager.username);
    const techToken = await login(tech.username);
    const sampleId = await sampleWithVerifiedResult(mgrToken, techToken);
    const issued = await server.inject({
      method: "POST",
      url: `/samples/${sampleId}/certificates`,
      headers: auth(mgrToken),
    });
    const coaId = issued.json().id;
    await expect(
      owner.client`UPDATE certificate_of_analysis SET coa_number = 'X' WHERE id = ${coaId}`,
    ).rejects.toThrow();
    await expect(
      owner.client`DELETE FROM certificate_of_analysis WHERE id = ${coaId}`,
    ).rejects.toThrow();
  });
});
