import { accessionSample, studyChainScope, verifyAuditChain, withActor } from "@lims-core/core";
import { createDb, databaseUrl, runMigrations } from "@lims-core/db";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestStudy, createTestUser, uniqueSuffix } from "../test-helpers.js";

/**
 * Compliance guarantees asserted against a real Postgres. These tests are the
 * teeth of docs/regulatory-traceability.md — each carries its requirement ID.
 * They connect as the OWNER role (worst realistic insider short of a DBA) and
 * as lims_app (the runtime role); both must be unable to falsify history.
 */

let owner: ReturnType<typeof createDb>;

function appRoleUrl(): string {
  const url = new URL(databaseUrl());
  url.username = "lims_app";
  url.password = "lims_app";
  return url.toString();
}

beforeAll(async () => {
  await runMigrations();
  owner = createDb(databaseUrl());
});

afterAll(async () => {
  await owner.client.end();
});

async function seedSampleWithAudit() {
  const user = await createTestUser(owner.db, { username: `compliance-${uniqueSuffix()}` });
  const { study, site } = await createTestStudy(owner.db);
  const sample = await withActor(owner.db, { userId: user.id, label: user.username }, (tx) =>
    accessionSample(tx, {
      studyId: study.id,
      studyOid: study.oid,
      siteId: site.id,
      sampleType: "serum",
      actorId: user.id,
    }),
  );
  return { user, study, site, sample };
}

describe("append-only enforcement (P11-01, P11-02, CoC-02)", () => {
  it("rejects UPDATE and DELETE on audit_event, even for the owner", async () => {
    await seedSampleWithAudit();
    await expect(
      owner.client`UPDATE audit_event SET actor_label = 'forged' WHERE id = (SELECT max(id) FROM audit_event)`,
    ).rejects.toThrow(/append-only/);
    await expect(
      owner.client`DELETE FROM audit_event WHERE id = (SELECT max(id) FROM audit_event)`,
    ).rejects.toThrow(/append-only/);
  });

  it("rejects UPDATE and DELETE on custody_event (CoC-02)", async () => {
    const { sample } = await seedSampleWithAudit();
    await expect(
      owner.client`UPDATE custody_event SET event_type = 'disposal' WHERE sample_id = ${sample.id}`,
    ).rejects.toThrow(/append-only/);
    await expect(
      owner.client`DELETE FROM custody_event WHERE sample_id = ${sample.id}`,
    ).rejects.toThrow(/append-only/);
  });

  it("rejects UPDATE and DELETE on result versions (P11-02)", async () => {
    const { user, study, sample } = await seedSampleWithAudit();
    await owner.client`
      INSERT INTO analysis_service (code, name) VALUES (${`RES-${uniqueSuffix()}`}, 'Assay')`;
    const [svc] =
      await owner.client`SELECT id FROM analysis_service ORDER BY created_at DESC LIMIT 1`;
    await owner.client`
      INSERT INTO analysis_request (sample_id, study_id, service_id, requested_by)
      VALUES (${sample.id}, ${study.id}, ${svc?.id}, ${user.id})`;
    const [req] =
      await owner.client`SELECT id FROM analysis_request WHERE sample_id = ${sample.id}`;
    await owner.client`
      INSERT INTO result (request_id, study_id, version, value, status, entered_by)
      VALUES (${req?.id}, ${study.id}, 1, '4.2', 'entered', ${user.id})`;
    await expect(
      owner.client`UPDATE result SET value = '9.9' WHERE request_id = ${req?.id}`,
    ).rejects.toThrow(/append-only/);
    await expect(owner.client`DELETE FROM result WHERE request_id = ${req?.id}`).rejects.toThrow(
      /append-only/,
    );
  });
});

describe("signature immutability (P11-10, §11.70)", () => {
  async function seedSignature() {
    const { user, study, sample } = await seedSampleWithAudit();
    await owner.client`
      INSERT INTO analysis_service (code, name) VALUES (${`SIG-${uniqueSuffix()}`}, 'Assay')`;
    const [svc] =
      await owner.client`SELECT id FROM analysis_service ORDER BY created_at DESC LIMIT 1`;
    const [req] = await owner.client`
      INSERT INTO analysis_request (sample_id, study_id, service_id, requested_by)
      VALUES (${sample.id}, ${study.id}, ${svc?.id}, ${user.id}) RETURNING id`;
    const [res] = await owner.client`
      INSERT INTO result (request_id, study_id, version, value, status, entered_by)
      VALUES (${req?.id}, ${study.id}, 1, '4.2', 'verified', ${user.id}) RETURNING id`;
    const [sig] = await owner.client`
      INSERT INTO signature (request_id, result_id, study_id, signer_id, meaning, record_hash)
      VALUES (${req?.id}, ${res?.id}, ${study.id}, ${user.id}, 'result_release', ${"a".repeat(64)})
      RETURNING id`;
    return sig?.id as string;
  }

  it("rejects DELETE and edits of signed fields; allows one-way invalidation", async () => {
    const sigId = await seedSignature();
    await expect(owner.client`DELETE FROM signature WHERE id = ${sigId}`).rejects.toThrow(/11\.70/);
    await expect(
      owner.client`UPDATE signature SET meaning = 'review' WHERE id = ${sigId}`,
    ).rejects.toThrow(/immutable/);
    // Invalidation of a live signature is the one permitted transition...
    await owner.client`
      UPDATE signature SET invalidated_at = now(), invalidated_reason = 'entered in error'
      WHERE id = ${sigId}`;
    // ...and it is one-way: an invalidated signature can never change again.
    await expect(
      owner.client`UPDATE signature SET invalidated_reason = 'rewritten' WHERE id = ${sigId}`,
    ).rejects.toThrow(/immutable/);
  });
});

describe("audit forgery paths (P11-01)", () => {
  it("denies the runtime role direct INSERT into audit_event", async () => {
    const app = postgres(appRoleUrl(), { onnotice: () => {} });
    try {
      await expect(app`
        INSERT INTO audit_event
          (chain_scope, occurred_at, actor_label, action, entity_type, prev_hash, hash)
        VALUES ('global', now(), 'forger', 'x.insert', 'x', ${"0".repeat(64)}, ${"f".repeat(64)})
      `).rejects.toThrow(/permission denied/);
    } finally {
      await app.end();
    }
  });

  it("still audits writes made by the runtime role (SECURITY DEFINER path)", async () => {
    const { study, site } = await seedSampleWithAudit();
    const app = postgres(appRoleUrl(), { onnotice: () => {} });
    try {
      await app`SELECT set_config('lims.actor_label', 'app-role-test', false)`;
      await app`
        INSERT INTO sample (study_id, site_id, accession_id, sample_type, created_by)
        VALUES (${study.id}, ${site.id}, ${`APP-${uniqueSuffix()}`}, 'plasma',
                (SELECT id FROM app_user LIMIT 1))`;
      const rows = await app`
        SELECT count(*)::int AS n FROM audit_event
        WHERE chain_scope = ${studyChainScope(study.id)} AND actor_label = 'app-role-test'`;
      expect(rows[0]?.n).toBeGreaterThan(0);
    } finally {
      await app.end();
    }
  });
});

describe("hash chain (P11-03, ADR-0002)", () => {
  it("verifies clean per-study chains independently", async () => {
    const a = await seedSampleWithAudit();
    const b = await seedSampleWithAudit();
    expect(await verifyAuditChain(owner.db, studyChainScope(a.study.id))).toEqual([]);
    expect(await verifyAuditChain(owner.db, studyChainScope(b.study.id))).toEqual([]);
    // Chains are disjoint: each study's events reference only their own scope.
    const cross = await owner.client`
      SELECT count(*)::int AS n FROM audit_event
      WHERE chain_scope = ${studyChainScope(a.study.id)}
        AND entity_id = ${b.sample.id}`;
    expect(cross[0]?.n).toBe(0);
  });

  it("detects a tampered event after trigger circumvention by the table owner", async () => {
    const { study } = await seedSampleWithAudit();
    const scope = studyChainScope(study.id);
    // Simulate the strongest realistic attacker: the table owner disabling
    // the append-only trigger to rewrite history. The chain must still tell.
    await owner.client`ALTER TABLE audit_event DISABLE TRIGGER audit_event_append_only`;
    try {
      await owner.client`
        UPDATE audit_event SET after = jsonb_set(after, '{sample_type}', '"tampered"')
        WHERE id = (
          SELECT id FROM audit_event
          WHERE chain_scope = ${scope} AND action = 'sample.insert' LIMIT 1)`;
    } finally {
      await owner.client`ALTER TABLE audit_event ENABLE TRIGGER audit_event_append_only`;
    }
    const problems = await verifyAuditChain(owner.db, scope);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]?.problem).toMatch(/hash does not match/);
  });
});
