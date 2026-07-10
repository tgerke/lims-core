// Must stay in sync with the role seed in packages/db/migrations/0003_seed_roles.sql.
export const PERMISSIONS = [
  "study.manage",
  "sample.accession",
  "sample.store",
  "order.create",
  "result.enter",
  "result.verify",
  "result.sign",
  "audit.review",
  "roles.grant",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
