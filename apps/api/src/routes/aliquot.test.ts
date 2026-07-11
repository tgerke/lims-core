import { withActor } from "@lims-core/core";
import { createDb, type Db, databaseUrl, runMigrations, samples } from "@lims-core/db";
import { eq } from "drizzle-orm";
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
 * Aliquot workflow (CoC-04): splitting a parent into child aliquots preserves
 * an auditable parent→child lineage and conserves quantity. Exercised through
 * the HTTP surface with a technician (holds sample.aliquot) and an accessioner
 * (does not).
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

async function accession(token: string): Promise<{ id: string; accessionId: string }> {
  const res = await server.inject({
    method: "POST",
    url: `/studies/${studyId}/samples`,
    headers: auth(token),
    payload: { siteId, sampleType: "whole_blood" },
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

// The accession route doesn't set quantity; seed it directly (audited) so the
// parent has a tracked amount to conserve.
async function setQuantity(db: Db, sampleId: string, quantity: string, unit: string) {
  await withActor(db, { label: "test-setup" }, async (tx) => {
    await tx
      .update(samples)
      .set({ quantity, quantityUnit: unit, initialQuantity: quantity })
      .where(eq(samples.id, sampleId));
  });
}

function detail(token: string, sampleId: string) {
  return server.inject({ url: `/samples/${sampleId}`, headers: auth(token) });
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

describe("aliquot workflow (CoC-04)", () => {
  it("splits a tracked parent into children, conserving quantity and lineage", async () => {
    const token = await login(tech.username);
    const parent = await accession(token);
    await setQuantity(owner.db, parent.id, "10", "mL");

    const res = await server.inject({
      method: "POST",
      url: `/samples/${parent.id}/aliquot`,
      headers: auth(token),
      payload: { count: 3, volume: 2 },
    });
    expect(res.statusCode).toBe(201);
    const { parent: updatedParent, children } = res.json();

    // Three parent-suffixed children.
    expect(children).toHaveLength(3);
    const childIds = children.map((c: { accessionId: string }) => c.accessionId).sort();
    expect(childIds).toEqual([
      `${parent.accessionId}.1`,
      `${parent.accessionId}.2`,
      `${parent.accessionId}.3`,
    ]);
    // Quantity conserved: 10 - 3*2 = 4 remaining; each child holds 2.
    expect(Number(updatedParent.quantity)).toBe(4);
    expect(updatedParent.status).toBe("registered");
    for (const child of children) expect(Number(child.quantity)).toBe(2);

    // Lineage links both ways.
    const parentDetail = (await detail(token, parent.id)).json();
    expect(parentDetail.lineage.children).toHaveLength(3);
    const childDetail = (await detail(token, children[0].id)).json();
    expect(childDetail.lineage.parent.accessionId).toBe(parent.accessionId);

    // Custody: an aliquot event on the parent and on each child.
    const parentCustody = parentDetail.custody.map((c: { eventType: string }) => c.eventType);
    expect(parentCustody).toContain("aliquot");
    const childCustody = childDetail.custody.map((c: { eventType: string }) => c.eventType);
    expect(childCustody).toEqual(["aliquot"]);
  });

  it("continues the ordinal across repeat aliquoting", async () => {
    const token = await login(tech.username);
    const parent = await accession(token);
    await setQuantity(owner.db, parent.id, "10", "mL");

    await server.inject({
      method: "POST",
      url: `/samples/${parent.id}/aliquot`,
      headers: auth(token),
      payload: { count: 2, volume: 1 },
    });
    const second = await server.inject({
      method: "POST",
      url: `/samples/${parent.id}/aliquot`,
      headers: auth(token),
      payload: { count: 1, volume: 1 },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().children[0].accessionId).toBe(`${parent.accessionId}.3`);
  });

  it("rejects drawing more than the parent holds", async () => {
    const token = await login(tech.username);
    const parent = await accession(token);
    await setQuantity(owner.db, parent.id, "5", "mL");

    const res = await server.inject({
      method: "POST",
      url: `/samples/${parent.id}/aliquot`,
      headers: auth(token),
      payload: { count: 3, volume: 2 },
    });
    expect(res.statusCode).toBe(409);
  });

  it("depletes the parent when drawn to zero and blocks further aliquoting", async () => {
    const token = await login(tech.username);
    const parent = await accession(token);
    await setQuantity(owner.db, parent.id, "4", "mL");

    const drain = await server.inject({
      method: "POST",
      url: `/samples/${parent.id}/aliquot`,
      headers: auth(token),
      payload: { count: 2, volume: 2 },
    });
    expect(drain.statusCode).toBe(201);
    expect(drain.json().parent.status).toBe("depleted");

    const again = await server.inject({
      method: "POST",
      url: `/samples/${parent.id}/aliquot`,
      headers: auth(token),
      payload: { count: 1, volume: 1 },
    });
    expect(again.statusCode).toBe(409);
  });

  it("aliquots an untracked sample without a volume", async () => {
    const token = await login(tech.username);
    const parent = await accession(token);

    const res = await server.inject({
      method: "POST",
      url: `/samples/${parent.id}/aliquot`,
      headers: auth(token),
      payload: { count: 2 },
    });
    expect(res.statusCode).toBe(201);
    const { children } = res.json();
    expect(children).toHaveLength(2);
    expect(children[0].quantity).toBeNull();
  });

  it("requires a volume when the parent tracks quantity", async () => {
    const token = await login(tech.username);
    const parent = await accession(token);
    await setQuantity(owner.db, parent.id, "10", "mL");

    const res = await server.inject({
      method: "POST",
      url: `/samples/${parent.id}/aliquot`,
      headers: auth(token),
      payload: { count: 2 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("denies aliquoting without sample.aliquot", async () => {
    const techToken = await login(tech.username);
    const parent = await accession(techToken);

    const accToken = await login(accessioner.username);
    const res = await server.inject({
      method: "POST",
      url: `/samples/${parent.id}/aliquot`,
      headers: auth(accToken),
      payload: { count: 1 },
    });
    expect(res.statusCode).toBe(403);
  });
});
