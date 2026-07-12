import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  version: z.string(),
  time: z.iso.datetime(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const loginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

// Biobank specialization ships first; "other" keeps the core domain-neutral
// for analytical samples.
export const SAMPLE_TYPES = [
  "whole_blood",
  "serum",
  "plasma",
  "tissue",
  "urine",
  "dna",
  "rna",
  "other",
] as const;
export const sampleTypeSchema = z.enum(SAMPLE_TYPES);
export type SampleType = z.infer<typeof sampleTypeSchema>;

export const accessionRequestSchema = z.object({
  siteId: z.uuid(),
  sampleType: sampleTypeSchema,
  // EDC references only — never PHI (platform-spine rule).
  subjectKey: z.string().min(1).max(64).optional(),
  studyEventOid: z.string().min(1).max(128).optional(),
  collectedAt: z.iso.datetime({ offset: true }).optional(),
});
export type AccessionRequest = z.infer<typeof accessionRequestSchema>;

export const bulkAccessionSchema = z.object({
  siteId: z.uuid(),
  sampleType: sampleTypeSchema,
  count: z.number().int().min(1).max(96),
  subjectKey: z.string().min(1).max(64).optional(),
  studyEventOid: z.string().min(1).max(128).optional(),
  collectedAt: z.iso.datetime({ offset: true }).optional(),
  // Optional box to fill sequentially from the first free position.
  storageUnitId: z.uuid().optional(),
});
export type BulkAccessionRequest = z.infer<typeof bulkAccessionSchema>;

// Bulk import: a raw manifest CSV, parsed and validated server-side.
export const importManifestSchema = z.object({
  csv: z.string().min(1).max(2_000_000),
});
export type ImportManifestRequest = z.infer<typeof importManifestSchema>;

export const storeRequestSchema = z.object({
  storageUnitId: z.uuid(),
  position: z
    .string()
    .regex(/^[A-Z]\d{1,2}$/, "positions look like A1..H12")
    .optional(),
});
export type StoreRequest = z.infer<typeof storeRequestSchema>;

// Interactive freezer-map placement (ADR-0015): position is required — a map
// click always targets a specific cell.
export const moveRequestSchema = z.object({
  storageUnitId: z.uuid(),
  position: z.string().regex(/^[A-Z]\d{1,2}$/, "positions look like A1..H12"),
});
export type MoveRequest = z.infer<typeof moveRequestSchema>;

export const aliquotRequestSchema = z.object({
  count: z.number().int().min(1).max(96),
  // Per-child amount; required by the server when the parent tracks quantity.
  volume: z.number().positive().optional(),
});
export type AliquotRequest = z.infer<typeof aliquotRequestSchema>;

// Consent-withdrawal holds and disposal (CoC-05). Target exactly one of a single
// sample or a subject (all that subject's samples); both expand to lineage
// descendants server-side. Reason is required for the audit trail.
const holdTargetShape = {
  sampleId: z.uuid().optional(),
  subjectKey: z.string().min(1).max(64).optional(),
  reason: z.string().min(1).max(500),
};
const oneTarget = (d: { sampleId?: string | undefined; subjectKey?: string | undefined }) =>
  (d.sampleId ? 1 : 0) + (d.subjectKey ? 1 : 0) === 1;
const oneTargetMsg = { message: "provide exactly one of sampleId or subjectKey" };

export const holdRequestSchema = z.object(holdTargetShape).refine(oneTarget, oneTargetMsg);
export type HoldRequest = z.infer<typeof holdRequestSchema>;

export const disposeRequestSchema = z
  .object({ ...holdTargetShape, method: z.string().min(1).max(200).optional() })
  .refine(oneTarget, oneTargetMsg);
export type DisposeRequest = z.infer<typeof disposeRequestSchema>;

// Concentration measurement (ADR-0013). Freeze-thaw takes no body.
export const concentrationSchema = z.object({
  concentration: z.number().nonnegative(),
  unit: z.string().min(1).max(20).optional(),
});
export type ConcentrationRequest = z.infer<typeof concentrationSchema>;

// Derivation (one parent -> new type) and pooling (many parents -> one), ADR-0014.
export const deriveRequestSchema = z.object({
  derivedType: sampleTypeSchema,
  quantity: z.number().positive().optional(),
  quantityUnit: z.string().min(1).max(20).optional(),
});
export type DeriveRequest = z.infer<typeof deriveRequestSchema>;

export const poolRequestSchema = z.object({
  parentIds: z.array(z.uuid()).min(2).max(96),
  pooledType: sampleTypeSchema.optional(),
  quantity: z.number().positive().optional(),
  quantityUnit: z.string().min(1).max(20).optional(),
});
export type PoolRequest = z.infer<typeof poolRequestSchema>;

export const createShipmentSchema = z.object({
  destination: z.string().min(1).max(200),
  originSiteId: z.uuid().optional(),
  carrier: z.string().min(1).max(100).optional(),
  trackingNumber: z.string().min(1).max(100).optional(),
  sampleIds: z.array(z.uuid()).min(1).max(500),
});
export type CreateShipmentRequest = z.infer<typeof createShipmentSchema>;

// Collection kits (ADR-0011): empty containers assembled and sent to a site.
export const createKitSchema = z.object({
  destinationSiteId: z.uuid(),
  carrier: z.string().min(1).max(100).optional(),
  trackingNumber: z.string().min(1).max(100).optional(),
  notes: z.string().min(1).max(1000).optional(),
  items: z
    .array(
      z.object({
        containerType: z.string().min(1).max(100),
        quantity: z.number().int().min(1).max(10000),
      }),
    )
    .min(1)
    .max(50),
});
export type CreateKitRequest = z.infer<typeof createKitSchema>;

// Reagent/consumable inventory (ADR-0016). Lab-wide, not study-scoped.
export const INVENTORY_CATEGORIES = ["reagent", "consumable", "control", "standard"] as const;
export const inventoryCategorySchema = z.enum(INVENTORY_CATEGORIES);
export type InventoryCategory = z.infer<typeof inventoryCategorySchema>;

export const createItemSchema = z.object({
  name: z.string().min(1).max(200),
  catalogNumber: z.string().min(1).max(100).optional(),
  vendor: z.string().min(1).max(200).optional(),
  category: inventoryCategorySchema.optional(),
  unit: z.string().min(1).max(20),
});
export type CreateItemRequest = z.infer<typeof createItemSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dates look like YYYY-MM-DD");

export const receiveLotSchema = z.object({
  itemId: z.uuid(),
  lotNumber: z.string().min(1).max(100),
  quantity: z.number().positive(),
  expiryDate: isoDate.optional(),
  receivedDate: isoDate.optional(),
  storageUnitId: z.uuid().optional(),
  notes: z.string().min(1).max(1000).optional(),
});
export type ReceiveLotRequest = z.infer<typeof receiveLotSchema>;

export const consumeLotSchema = z.object({
  quantity: z.number().positive(),
  note: z.string().min(1).max(1000).optional(),
});
export type ConsumeLotRequest = z.infer<typeof consumeLotSchema>;

export const adjustLotSchema = z.object({
  delta: z.number().refine((n) => n !== 0, "adjustment delta must be non-zero"),
  note: z.string().min(1).max(1000).optional(),
});
export type AdjustLotRequest = z.infer<typeof adjustLotSchema>;

export const discardLotSchema = z.object({
  note: z.string().min(1).max(1000).optional(),
});
export type DiscardLotRequest = z.infer<typeof discardLotSchema>;

export const orderRequestSchema = z.object({
  serviceId: z.uuid(),
});
export type OrderRequest = z.infer<typeof orderRequestSchema>;

// Worksheets/runs (ADR-0018): batch orders for an instrument run and record the
// reagent lots it consumes.
export const createWorksheetSchema = z.object({
  instrument: z.string().min(1).max(200).optional(),
  notes: z.string().min(1).max(1000).optional(),
  requestIds: z.array(z.uuid()).min(1).max(500),
});
export type CreateWorksheetRequest = z.infer<typeof createWorksheetSchema>;

export const recordReagentSchema = z.object({
  lotId: z.uuid(),
  quantity: z.number().positive(),
  note: z.string().min(1).max(1000).optional(),
});
export type RecordReagentRequest = z.infer<typeof recordReagentSchema>;

// Analytical acceptance criteria (ADR-0017): a numeric range (a bound on either
// side) or a qualitative expected value, never both.
export const createSpecificationSchema = z
  .object({
    unit: z.string().min(1).max(20).optional(),
    lowerLimit: z.number().optional(),
    upperLimit: z.number().optional(),
    expectedValue: z.string().min(1).max(200).optional(),
  })
  .refine(
    (d) => {
      const hasRange = d.lowerLimit !== undefined || d.upperLimit !== undefined;
      const hasExpected = d.expectedValue !== undefined;
      return hasRange !== hasExpected;
    },
    { message: "provide either numeric limits or an expected value, not both" },
  );
export type CreateSpecificationRequest = z.infer<typeof createSpecificationSchema>;

// QC control samples (ADR-0019): a control material's established target for a
// service, and a control measurement recorded on a run.
export const createControlMaterialSchema = z.object({
  level: z.string().min(1).max(50),
  lotNumber: z.string().min(1).max(100),
  targetMean: z.number(),
  targetSd: z.number().positive(),
  expiry: z.iso.date().optional(),
  unit: z.string().min(1).max(20).optional(),
});
export type CreateControlMaterialRequest = z.infer<typeof createControlMaterialSchema>;

export const recordQcMeasurementSchema = z.object({
  controlMaterialId: z.uuid(),
  value: z.number(),
});
export type RecordQcMeasurementRequest = z.infer<typeof recordQcMeasurementSchema>;

// Calculated results (ADR-0020): a formula over input analytes on the same
// sample. Variable names match identifiers the expression may reference.
export const createCalculationSchema = z.object({
  expression: z.string().min(1).max(500),
  inputs: z
    .array(
      z.object({
        variable: z
          .string()
          .min(1)
          .max(50)
          .regex(/^[A-Za-z_]\w*$/, "variable must be a valid identifier"),
        serviceId: z.uuid(),
      }),
    )
    .min(1)
    .max(20),
});
export type CreateCalculationRequest = z.infer<typeof createCalculationSchema>;

export const computeCalculationSchema = z
  .object({ reasonForChange: z.string().min(1).max(1000).optional() })
  .optional();

export const resultEntrySchema = z.object({
  value: z.string().min(1),
  unit: z.string().min(1).optional(),
  /** Required by the server when correcting an existing result (P11-02). */
  reasonForChange: z.string().min(1).optional(),
});
export type ResultEntry = z.infer<typeof resultEntrySchema>;

// E-sign step-up (ADR-0003): the signer re-enters their password with every
// signature; the meaning is displayed and recorded (§11.50).
export const signRequestSchema = z.object({
  password: z.string().min(1),
  meaning: z.enum(["result_release", "responsibility", "review"]).default("result_release"),
});
export type SignRequest = z.infer<typeof signRequestSchema>;

export const grantRoleRequestSchema = z.object({
  userId: z.uuid(),
  roleId: z.uuid(),
  siteId: z.uuid().optional(),
});
export type GrantRoleRequest = z.infer<typeof grantRoleRequestSchema>;
