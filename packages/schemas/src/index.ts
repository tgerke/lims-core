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

export const orderRequestSchema = z.object({
  serviceId: z.uuid(),
});
export type OrderRequest = z.infer<typeof orderRequestSchema>;

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
