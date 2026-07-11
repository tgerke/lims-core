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
 * Reporting and exports: study-scoped inventory counts, turnaround-time metrics,
 * and a sample-manifest CSV. Read-only, membership-gated aggregates (ADR-0010).
 */

let server: FastifyInstance;
let owner: ReturnType<typeof createDb>;

let studyId: string;
let studyOid: string;
let siteId: string;
let boxId: string;
let tech: { id: string; username: string };
let outsider: { id: string; username: string };

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

async function accession(token: string, sampleType: string, collectedAt?: string): Promise<string> {
  const res = await server.inject({
    method: "POST",
    url: `/studies/${studyId}/samples`,
    headers: auth(token),
    payload: { siteId, sampleType, ...(collectedAt ? { collectedAt } : {}) },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id;
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
  outsider = await createTestUser(owner.db, { username: `out-${suffix}` });

  const created = await createTestStudy(owner.db);
  studyId = created.study.id;
  studyOid = created.study.oid;
  siteId = created.site.id;
  await grantTestRole(owner.db, tech.id, studyId, "technician", admin.id);

  boxId = (await createTestBox(owner.db, 3, 3)).id;

  const token = await login(tech.username);
  // Two serum (one stored, with a known collection time) and one plasma.
  const collected = new Date(Date.now() - 6 * 3_600_000).toISOString();
  const stored = await accession(token, "serum", collected);
  await accession(token, "serum");
  await accession(token, "plasma");
  await server.inject({
    method: "POST",
    url: `/samples/${stored}/store`,
    headers: auth(token),
    payload: { storageUnitId: boxId, position: "A1" },
  });
});

afterAll(async () => {
  await server.close();
});

describe("reporting and exports", () => {
  it("counts inventory by status, type, and site", async () => {
    const token = await login(tech.username);
    const res = await server.inject({
      url: `/studies/${studyId}/reports/inventory`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(3);
    const status = Object.fromEntries(
      body.byStatus.map((r: { key: string; count: number }) => [r.key, r.count]),
    );
    expect(status.registered).toBe(2);
    expect(status.in_storage).toBe(1);
    const type = Object.fromEntries(
      body.byType.map((r: { key: string; count: number }) => [r.key, r.count]),
    );
    expect(type.serum).toBe(2);
    expect(type.plasma).toBe(1);
    expect(body.bySite).toHaveLength(1);
    expect(body.bySite[0].count).toBe(3);
  });

  it("computes turnaround-time metrics", async () => {
    const token = await login(tech.username);
    const res = await server.inject({
      url: `/studies/${studyId}/reports/turnaround`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // One sample had a collection time ~6h before receipt.
    expect(body.collectionToReceipt.n).toBe(1);
    expect(body.collectionToReceipt.medianHours).toBeGreaterThan(5);
    // One sample was stored shortly after receipt.
    expect(body.receiptToStorage.n).toBe(1);
    expect(body.receiptToStorage.maxHours).toBeGreaterThanOrEqual(0);
  });

  it("exports a study-scoped sample manifest as CSV", async () => {
    const token = await login(tech.username);
    const res = await server.inject({
      url: `/studies/${studyId}/reports/manifest.csv`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain(`${studyOid}-manifest.csv`);
    const lines = res.body.trim().split("\r\n");
    expect(lines[0]).toBe(
      "accession_id,sample_type,status,subject_key,study_event_oid,site_oid,collected_at,received_at,storage_unit,storage_position,quantity,quantity_unit",
    );
    expect(lines).toHaveLength(4); // header + 3 samples
    expect(res.body).toContain("in_storage");
  });

  it("denies reports to a non-member", async () => {
    const token = await login(outsider.username);
    const res = await server.inject({
      url: `/studies/${studyId}/reports/inventory`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(403);
  });
});
