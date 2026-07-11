import {
  accessionSample,
  bulkAccessionSamples,
  createKit,
  createShipment,
  withActor,
} from "@lims-core/core";
import {
  analysisServices,
  createDb,
  databaseUrl,
  roles,
  runMigrations,
  samples,
  sites,
  storageUnits,
  studies,
  userStudyRoles,
  users,
} from "@lims-core/db";
import { eq } from "drizzle-orm";
import { hashPassword } from "../auth/password.js";

// Demo/dev bootstrap: an admin, one study/site, a storage tree, three
// analysis services, and one user per lab role. Idempotent — keyed on the
// study OID. Dev-grade passwords, printed at the end; never seed production.

const ADMIN_PASSWORD = process.env.LIMS_ADMIN_PASSWORD ?? "lims-admin-2026!";
const DEMO_PASSWORD = process.env.LIMS_DEMO_PASSWORD ?? "lims-demo-2026!";
const STUDY_OID = "DEMO-001";

async function main() {
  await runMigrations();
  const { db, client } = createDb(databaseUrl());
  try {
    const [existing] = await db.select().from(studies).where(eq(studies.oid, STUDY_OID)).limit(1);
    if (existing) {
      console.log(`seed: study ${STUDY_OID} already present, nothing to do`);
      return;
    }

    const adminHash = await hashPassword(ADMIN_PASSWORD);
    const demoHash = await hashPassword(DEMO_PASSWORD);

    await withActor(db, { label: "seed-demo" }, async (tx) => {
      const [admin] = await tx
        .insert(users)
        .values({
          username: "admin",
          email: "admin@lims.local",
          fullName: "System Administrator",
          passwordHash: adminHash,
          isSystemAdmin: true,
        })
        .returning();
      if (!admin) throw new Error("admin insert failed");

      const demoUsers = await tx
        .insert(users)
        .values([
          {
            username: "mgarcia",
            email: "mgarcia@lims.local",
            fullName: "Maria Garcia",
            passwordHash: demoHash,
          },
          {
            username: "tchen",
            email: "tchen@lims.local",
            fullName: "Tom Chen",
            passwordHash: demoHash,
          },
          {
            username: "rpatel",
            email: "rpatel@lims.local",
            fullName: "Rina Patel",
            passwordHash: demoHash,
          },
        ])
        .returning();

      const [study] = await tx
        .insert(studies)
        .values({ oid: STUDY_OID, name: "Demo Biobank Study" })
        .returning();
      if (!study) throw new Error("study insert failed");
      const [site] = await tx
        .insert(sites)
        .values({ studyId: study.id, oid: "SITE-01", name: "Central Clinical Site" })
        .returning();
      if (!site) throw new Error("site insert failed");

      const allRoles = await tx.select().from(roles);
      const roleId = (name: string) => {
        const role = allRoles.find((r) => r.name === name);
        if (!role) throw new Error(`seed expects role ${name} from 0003_seed_roles.sql`);
        return role.id;
      };
      const byUsername = (username: string) => {
        const u = demoUsers.find((x) => x.username === username);
        if (!u) throw new Error(`missing demo user ${username}`);
        return u.id;
      };
      await tx.insert(userStudyRoles).values([
        { userId: admin.id, studyId: study.id, roleId: roleId("lab_admin"), grantedBy: admin.id },
        {
          userId: byUsername("mgarcia"),
          studyId: study.id,
          roleId: roleId("lab_manager"),
          grantedBy: admin.id,
        },
        {
          userId: byUsername("tchen"),
          studyId: study.id,
          roleId: roleId("technician"),
          grantedBy: admin.id,
        },
        {
          userId: byUsername("rpatel"),
          studyId: study.id,
          roleId: roleId("accessioner"),
          grantedBy: admin.id,
        },
      ]);

      const [facility] = await tx
        .insert(storageUnits)
        .values({ name: "Main Biorepository", kind: "facility" })
        .returning();
      if (!facility) throw new Error("facility insert failed");
      const [freezer] = await tx
        .insert(storageUnits)
        .values({
          parentId: facility.id,
          name: "Freezer A (-80C)",
          kind: "freezer",
          temperatureC: "-80",
        })
        .returning();
      if (!freezer) throw new Error("freezer insert failed");
      const [shelf] = await tx
        .insert(storageUnits)
        .values({ parentId: freezer.id, name: "Shelf 1", kind: "shelf" })
        .returning();
      if (!shelf) throw new Error("shelf insert failed");
      const [rack] = await tx
        .insert(storageUnits)
        .values({ parentId: shelf.id, name: "Rack 1", kind: "rack" })
        .returning();
      if (!rack) throw new Error("rack insert failed");
      const [boxA] = await tx
        .insert(storageUnits)
        .values([
          { parentId: rack.id, name: "Box A", kind: "box", gridRows: 9, gridCols: 9 },
          { parentId: rack.id, name: "Box B", kind: "box", gridRows: 9, gridCols: 9 },
        ])
        .returning();
      if (!boxA) throw new Error("box insert failed");

      await tx.insert(analysisServices).values([
        { code: "PSA", name: "Prostate-Specific Antigen", unit: "ng/mL" },
        { code: "TESTO", name: "Total Testosterone", unit: "ng/dL" },
        { code: "CTDNA", name: "ctDNA Yield", unit: "ng" },
      ]);

      // A whole-blood specimen with a tracked volume, ready to aliquot (CoC-04).
      const demoSample = await accessionSample(tx, {
        studyId: study.id,
        studyOid: study.oid,
        siteId: site.id,
        sampleType: "whole_blood",
        subjectKey: "SUBJ-001",
        collectedAt: new Date(),
        actorId: byUsername("tchen"),
      });
      await tx
        .update(samples)
        .set({ quantity: "10", quantityUnit: "mL", initialQuantity: "10" })
        .where(eq(samples.id, demoSample.id));

      // Two serum specimens packed into a shipment to the central lab (CoC-06).
      const packed = [];
      for (let i = 0; i < 2; i++) {
        packed.push(
          await accessionSample(tx, {
            studyId: study.id,
            studyOid: study.oid,
            siteId: site.id,
            sampleType: "serum",
            subjectKey: "SUBJ-002",
            collectedAt: new Date(),
            actorId: byUsername("tchen"),
          }),
        );
      }
      await createShipment(tx, {
        studyId: study.id,
        studyOid: study.oid,
        destination: "Central Biorepository",
        originSiteId: site.id,
        carrier: "World Courier",
        sampleIds: packed.map((s) => s.id),
        actorId: byUsername("tchen"),
      });

      // A collection kit assembled for the site (empty containers, CoC-agnostic).
      await createKit(tx, {
        studyId: study.id,
        studyOid: study.oid,
        destinationSiteId: site.id,
        carrier: "World Courier",
        items: [
          { containerType: "EDTA tube (10 mL)", quantity: 20 },
          { containerType: "Serum separator tube", quantity: 20 },
          { containerType: "Cryovial (2 mL)", quantity: 50 },
        ],
        actorId: byUsername("tchen"),
      });

      // A batch of serum specimens filling the first positions of Box A, so the
      // freezer map shows real occupancy.
      await bulkAccessionSamples(tx, {
        studyId: study.id,
        studyOid: study.oid,
        siteId: site.id,
        sampleType: "serum",
        count: 8,
        collectedAt: new Date(),
        storageUnitId: boxA.id,
        actorId: byUsername("tchen"),
      });
    });

    console.log(`seed: created study ${STUDY_OID} with site SITE-01`);
    console.log(`seed: users admin/${ADMIN_PASSWORD} (system admin + lab_admin),`);
    console.log(`      mgarcia/${DEMO_PASSWORD} (lab_manager),`);
    console.log(`      tchen/${DEMO_PASSWORD} (technician), rpatel/${DEMO_PASSWORD} (accessioner)`);
  } finally {
    await client.end();
  }
}

await main();
