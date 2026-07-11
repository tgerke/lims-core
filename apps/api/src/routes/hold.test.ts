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
 * Consent-withdrawal holds and disposal (CoC-05): a hold propagates across a
 * subject's samples and their lineage, blocks further use, is releasable to the
 * prior status, and disposal is a terminal, supervisor-only step.
 */

let server: FastifyInstance;
let owner: ReturnType<typeof createDb>;

let studyId: string;
let siteId: string;
let boxId: string;
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

async function accession(
  token: string,
  subjectKey?: string,
): Promise<{ id: string; accessionId: string }> {
  const res = await server.inject({
    method: "POST",
    url: `/studies/${studyId}/samples`,
    headers: auth(token),
    payload: { siteId, sampleType: "serum", ...(subjectKey ? { subjectKey } : {}) },
  });
  expect(res.statusCode).toBe(201);
  return res.json();
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
  manager = await createTestUser(owner.db, { username: `mgr-${suffix}` });
  tech = await createTestUser(owner.db, { username: `tech-${suffix}` });

  const created = await createTestStudy(owner.db);
  studyId = created.study.id;
  siteId = created.site.id;
  await grantTestRole(owner.db, manager.id, studyId, "lab_manager", admin.id);
  await grantTestRole(owner.db, tech.id, studyId, "technician", admin.id);

  boxId = (await createTestBox(owner.db, 3, 3)).id;
});

afterAll(async () => {
  await server.close();
});

function eventTypes(custody: { eventType: string }[]) {
  return custody.map((c) => c.eventType);
}

describe("consent-withdrawal holds (CoC-05)", () => {
  it("holds a whole subject, blocks use, and releases to the prior status", async () => {
    const token = await login(tech.username);
    const subject = `SUBJ-${uniqueSuffix()}`;
    const a = await accession(token, subject);
    const b = await accession(token, subject);
    const other = await accession(token, `SUBJ-${uniqueSuffix()}`);

    // Store one of the subject's samples so release can restore in_storage.
    await server.inject({
      method: "POST",
      url: `/samples/${a.id}/store`,
      headers: auth(token),
      payload: { storageUnitId: boxId, position: "A1" },
    });

    const held = await server.inject({
      method: "POST",
      url: `/studies/${studyId}/holds`,
      headers: auth(token),
      payload: { subjectKey: subject, reason: "consent withdrawn" },
    });
    expect(held.statusCode).toBe(201);
    expect(held.json().count).toBe(2);

    const aHeld = (await detail(token, a.id)).json();
    expect(aHeld.status).toBe("on_hold");
    expect(aHeld.preHoldStatus).toBe("in_storage");
    expect(eventTypes(aHeld.custody)).toContain("hold");
    // The other subject's sample is untouched.
    expect((await detail(token, other.id)).json().status).toBe("registered");

    // A held sample cannot be stored, aliquoted, or shipped.
    const storeDenied = await server.inject({
      method: "POST",
      url: `/samples/${b.id}/store`,
      headers: auth(token),
      payload: { storageUnitId: boxId, position: "B1" },
    });
    expect(storeDenied.statusCode).toBe(409);
    const shipDenied = await server.inject({
      method: "POST",
      url: `/studies/${studyId}/shipments`,
      headers: auth(token),
      payload: { destination: "Central", sampleIds: [a.id] },
    });
    expect(shipDenied.statusCode).toBe(409);

    // Release restores each sample to what it was before the hold.
    const released = await server.inject({
      method: "POST",
      url: `/studies/${studyId}/holds/release`,
      headers: auth(token),
      payload: { subjectKey: subject, reason: "consent reinstated" },
    });
    expect(released.statusCode).toBe(200);
    expect(released.json().count).toBe(2);

    const aReleased = (await detail(token, a.id)).json();
    expect(aReleased.status).toBe("in_storage");
    expect(aReleased.preHoldStatus).toBeNull();
    expect(eventTypes(aReleased.custody)).toContain("hold_release");
    expect((await detail(token, b.id)).json().status).toBe("registered");
  });

  it("propagates a hold to lineage descendants", async () => {
    const token = await login(tech.username);
    const parent = await accession(token);
    const aliquoted = await server.inject({
      method: "POST",
      url: `/samples/${parent.id}/aliquot`,
      headers: auth(token),
      payload: { count: 2 },
    });
    expect(aliquoted.statusCode).toBe(201);
    const childIds = aliquoted.json().children.map((c: { id: string }) => c.id);

    const held = await server.inject({
      method: "POST",
      url: `/studies/${studyId}/holds`,
      headers: auth(token),
      payload: { sampleId: parent.id, reason: "quarantine" },
    });
    expect(held.statusCode).toBe(201);
    expect(held.json().count).toBe(3); // parent + 2 aliquots

    for (const id of childIds) {
      expect((await detail(token, id)).json().status).toBe("on_hold");
    }
  });

  it("disposes as a terminal, supervisor-only step", async () => {
    const token = await login(tech.username);
    const sample = await accession(token);
    await server.inject({
      method: "POST",
      url: `/samples/${sample.id}/store`,
      headers: auth(token),
      payload: { storageUnitId: boxId, position: "C1" },
    });

    // A technician holds sample.hold but not sample.dispose.
    const disposeDenied = await server.inject({
      method: "POST",
      url: `/studies/${studyId}/disposals`,
      headers: auth(token),
      payload: { sampleId: sample.id, reason: "expired" },
    });
    expect(disposeDenied.statusCode).toBe(403);

    // A manager can dispose; the sample becomes terminal and frees its position.
    const managerToken = await login(manager.username);
    const disposed = await server.inject({
      method: "POST",
      url: `/studies/${studyId}/disposals`,
      headers: auth(managerToken),
      payload: { sampleId: sample.id, reason: "consent withdrawn", method: "autoclave" },
    });
    expect(disposed.statusCode).toBe(201);

    const gone = (await detail(token, sample.id)).json();
    expect(gone.status).toBe("disposed");
    expect(gone.storageUnit).toBeNull();
    expect(eventTypes(gone.custody)).toContain("disposal");

    // A disposed sample cannot be aliquoted.
    const aliquotDenied = await server.inject({
      method: "POST",
      url: `/samples/${sample.id}/aliquot`,
      headers: auth(token),
      payload: { count: 1 },
    });
    expect(aliquotDenied.statusCode).toBe(409);
  });
});
