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
 * CSV manifest import (bulk follow-on): valid rows accession in one transaction;
 * any invalid row rejects the whole file with a per-row report (all-or-nothing).
 */

let server: FastifyInstance;
let owner: ReturnType<typeof createDb>;

let studyId: string;
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

function importCsv(token: string, csv: string) {
  return server.inject({
    method: "POST",
    url: `/studies/${studyId}/samples/import`,
    headers: auth(token),
    payload: { csv },
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
  tech = await createTestUser(owner.db, { username: `tech-${suffix}` });
  monitor = await createTestUser(owner.db, { username: `mon-${suffix}` });

  const created = await createTestStudy(owner.db);
  studyId = created.study.id;
  await grantTestRole(owner.db, tech.id, studyId, "technician", admin.id);
  await grantTestRole(owner.db, monitor.id, studyId, "monitor", admin.id);
});

afterAll(async () => {
  await server.close();
});

describe("CSV manifest import", () => {
  it("accessions every row of a valid manifest", async () => {
    const token = await login(tech.username);
    const csv = [
      "site_oid,sample_type,subject_key,collected_at",
      "SITE-01,serum,SUBJ-100,2026-07-01T09:00:00Z",
      "SITE-01,plasma,SUBJ-101,",
      "SITE-01,whole_blood,SUBJ-102,2026-07-02T10:30:00Z",
    ].join("\n");
    const res = await importCsv(token, csv);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.count).toBe(3);
    // Each imported sample opened its chain of custody.
    const detail = await server.inject({
      url: `/samples/${body.samples[0].id}`,
      headers: auth(token),
    });
    expect(detail.json().custody.length).toBeGreaterThan(0);
  });

  it("rejects the whole file when any row is invalid", async () => {
    const token = await login(tech.username);
    const csv = [
      "site_oid,sample_type,subject_key",
      "SITE-01,serum,SUBJ-200",
      "SITE-01,unobtanium,SUBJ-201",
      "SITE-99,serum,SUBJ-202",
    ].join("\n");
    const res = await importCsv(token, csv);
    expect(res.statusCode).toBe(400);
    const body = res.json();
    const rowsWithErrors = body.errors.map((e: { row: number }) => e.row);
    expect(rowsWithErrors).toContain(3); // bad sample_type
    expect(rowsWithErrors).toContain(4); // unknown site_oid

    // Nothing was accessioned: the valid row on line 2 must not exist.
    const list = await server.inject({ url: `/studies/${studyId}/samples`, headers: auth(token) });
    const subjects = list.json().map((s: { subjectKey: string | null }) => s.subjectKey);
    expect(subjects).not.toContain("SUBJ-200");
  });

  it("rejects a manifest missing a required column", async () => {
    const token = await login(tech.username);
    const res = await importCsv(token, "subject_key\nSUBJ-300");
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].message).toMatch(/site_oid|sample_type/);
  });

  it("requires sample.accession", async () => {
    const monitorToken = await login(monitor.username);
    const res = await importCsv(monitorToken, "site_oid,sample_type\nSITE-01,serum");
    expect(res.statusCode).toBe(403);
  });
});
