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
 * Derivation and pooling lineage (ADR-0014): a derived specimen gets a new type
 * and its own accession id linked back to one parent; a pooled specimen links
 * back to many parents. Both open with the matching custody event.
 */

let server: FastifyInstance;
let owner: ReturnType<typeof createDb>;

let studyId: string;
let siteId: string;
let tech: { id: string; username: string };
let accessioner: { id: string; username: string };

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

async function accession(
  token: string,
  sampleType: string,
  subjectKey?: string,
): Promise<{ id: string; accessionId: string }> {
  const res = await server.inject({
    method: "POST",
    url: `/studies/${studyId}/samples`,
    headers: auth(token),
    payload: { siteId, sampleType, ...(subjectKey ? { subjectKey } : {}) },
  });
  expect(res.statusCode).toBe(201);
  return res.json();
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

  const created = await createTestStudy(owner.db);
  studyId = created.study.id;
  siteId = created.site.id;
  await grantTestRole(owner.db, tech.id, studyId, "technician", admin.id);
  await grantTestRole(owner.db, accessioner.id, studyId, "accessioner", admin.id);
});

afterAll(async () => {
  await server.close();
});

describe("derivation and pooling (ADR-0014)", () => {
  it("derives a new material type linked to its parent", async () => {
    const token = await login(tech.username);
    const parent = await accession(token, "whole_blood", "SUBJ-D1");
    const res = await server.inject({
      method: "POST",
      url: `/samples/${parent.id}/derive`,
      headers: auth(token),
      payload: { derivedType: "dna", quantity: 40, quantityUnit: "ng" },
    });
    expect(res.statusCode).toBe(201);
    const child = res.json().child;
    expect(child.sampleType).toBe("dna");
    expect(child.accessionId).not.toBe(parent.accessionId);

    const childDetail = (await detail(token, child.id)).json();
    expect(childDetail.lineage.parents).toHaveLength(1);
    expect(childDetail.lineage.parents[0].relation).toBe("derivation");
    expect(
      childDetail.custody.some((c: { eventType: string }) => c.eventType === "derivation"),
    ).toBe(true);

    const parentDetail = (await detail(token, parent.id)).json();
    expect(
      parentDetail.lineage.children.some((c: { relation: string }) => c.relation === "derivation"),
    ).toBe(true);
  });

  it("pools several parents into one specimen", async () => {
    const token = await login(tech.username);
    const a = await accession(token, "plasma", "SUBJ-P1");
    const b = await accession(token, "plasma", "SUBJ-P1");
    const c = await accession(token, "plasma", "SUBJ-P1");
    const res = await server.inject({
      method: "POST",
      url: `/studies/${studyId}/samples/pool`,
      headers: auth(token),
      payload: { parentIds: [a.id, b.id, c.id] },
    });
    expect(res.statusCode).toBe(201);
    const pooled = res.json().pooled;
    expect(pooled.sampleType).toBe("plasma");
    expect(pooled.subjectKey).toBe("SUBJ-P1"); // shared subject inherited

    const pooledDetail = (await detail(token, pooled.id)).json();
    expect(pooledDetail.lineage.parents).toHaveLength(3);
    expect(
      pooledDetail.lineage.parents.every((p: { relation: string }) => p.relation === "pool"),
    ).toBe(true);
  });

  it("drops the subject key when pooling mixes subjects", async () => {
    const token = await login(tech.username);
    const a = await accession(token, "serum", "SUBJ-MIX-A");
    const b = await accession(token, "serum", "SUBJ-MIX-B");
    const res = await server.inject({
      method: "POST",
      url: `/studies/${studyId}/samples/pool`,
      headers: auth(token),
      payload: { parentIds: [a.id, b.id] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().pooled.subjectKey).toBeNull();
  });

  it("rejects pooling a single sample and requires sample.aliquot", async () => {
    const token = await login(tech.username);
    const a = await accession(token, "serum");
    const one = await server.inject({
      method: "POST",
      url: `/studies/${studyId}/samples/pool`,
      headers: auth(token),
      payload: { parentIds: [a.id, a.id] }, // dedupes to one
    });
    expect(one.statusCode).toBe(400);

    const accToken = await login(accessioner.username);
    const denied = await server.inject({
      method: "POST",
      url: `/samples/${a.id}/derive`,
      headers: auth(accToken),
      payload: { derivedType: "dna" },
    });
    expect(denied.statusCode).toBe(403);
  });
});
