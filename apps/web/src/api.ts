export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: init?.body ? { "content-type": "application/json" } : {},
    ...init,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // non-JSON error body; keep statusText
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

export interface Me {
  id: string;
  username: string;
  fullName: string;
  isSystemAdmin: boolean;
  hasPassword: boolean;
}

export interface Study {
  id: string;
  oid: string;
  name: string;
}

export interface Site {
  id: string;
  oid: string;
  name: string;
}

export interface StorageUnit {
  id: string;
  parentId: string | null;
  name: string;
  kind: "facility" | "freezer" | "shelf" | "rack" | "box";
  gridRows: number | null;
  gridCols: number | null;
  temperatureC: string | null;
}

export interface SampleRow {
  id: string;
  accessionId: string;
  sampleType: string;
  status: string;
  quantity: string | null;
  quantityUnit: string | null;
  subjectKey: string | null;
  collectedAt: string | null;
  receivedAt: string | null;
  siteOid: string;
  storageUnit: string | null;
  storagePosition: string | null;
  createdAt: string;
}

export interface CustodyEvent {
  id: string;
  eventType: string;
  occurredAt: string;
  actor: string | null;
  storageUnit: string | null;
  position: string | null;
  details: Record<string, unknown> | null;
}

export interface LineageRef {
  id: string;
  accessionId: string;
  relation: string;
}

export interface SampleDetail {
  id: string;
  studyId: string;
  accessionId: string;
  sampleType: string;
  status: string;
  preHoldStatus: string | null;
  quantity: string | null;
  quantityUnit: string | null;
  initialQuantity: string | null;
  freezeThawCount: number;
  concentration: string | null;
  concentrationUnit: string | null;
  subjectKey: string | null;
  studyEventOid: string | null;
  collectedAt: string | null;
  receivedAt: string | null;
  storagePosition: string | null;
  site: Site | null;
  storageUnit: StorageUnit | null;
  custody: CustodyEvent[];
  lineage: { parents: LineageRef[]; children: LineageRef[] };
}

export interface ResultVersion {
  id: string;
  version: number;
  value: string;
  unit: string | null;
  status: "entered" | "verified";
  qcStatus: "pass" | "out_of_spec" | "not_evaluated";
  reasonForChange: string | null;
  enteredBy: string;
  createdAt: string;
}

export interface Specification {
  id: string;
  serviceId: string;
  unit: string | null;
  lowerLimit: string | null;
  upperLimit: string | null;
  expectedValue: string | null;
  active: boolean;
  effectiveFrom: string;
  createdAt: string;
}

export interface Signature {
  id: string;
  meaning: string;
  recordHash: string;
  signedAt: string;
  signer: string;
  signerName: string;
  invalidatedAt: string | null;
}

export interface Order {
  id: string;
  status: "ordered" | "resulted" | "verified" | "signed" | "cancelled";
  createdAt: string;
  serviceCode: string;
  serviceName: string;
  serviceUnit: string | null;
  requestedBy: string;
  results: ResultVersion[];
  signatures: Signature[];
}

export interface AnalysisService {
  id: string;
  code: string;
  name: string;
  unit: string | null;
}

export interface BoxMap {
  unit: {
    id: string;
    name: string;
    gridRows: number;
    gridCols: number;
    temperatureC: string | null;
  };
  occupants: { position: string; sampleId: string; accessionId: string; sampleType: string }[];
  othersOccupiedPositions: string[];
}

export interface ShipmentRow {
  id: string;
  shipmentNumber: string;
  status: "packed" | "in_transit" | "received" | "cancelled";
  destination: string;
  originSite: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  shippedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  itemCount: number;
}

export interface ShipmentItem {
  id: string;
  accessionId: string;
  sampleType: string;
  status: string;
}

export interface ShipmentDetail {
  id: string;
  shipmentNumber: string;
  status: "packed" | "in_transit" | "received" | "cancelled";
  destination: string;
  carrier: string | null;
  trackingNumber: string | null;
  shippedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  originSite: Site | null;
  createdBy: string | null;
  items: ShipmentItem[];
}

export interface CountRow {
  key: string;
  count: number;
}

export interface InventoryReport {
  total: number;
  byStatus: CountRow[];
  byType: CountRow[];
  bySite: CountRow[];
}

export interface DurationStats {
  n: number;
  avgHours: number;
  medianHours: number;
  maxHours: number;
}

export interface TurnaroundReport {
  collectionToReceipt: DurationStats | null;
  receiptToStorage: DurationStats | null;
}

export interface KitItem {
  containerType: string;
  quantity: number;
}

export interface KitRow {
  id: string;
  kitNumber: string;
  status: "assembled" | "shipped" | "delivered" | "cancelled";
  destinationSite: string;
  carrier: string | null;
  trackingNumber: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  items: KitItem[];
}

export interface InventoryItem {
  id: string;
  name: string;
  catalogNumber: string | null;
  vendor: string | null;
  category: "reagent" | "consumable" | "control" | "standard";
  unit: string;
  active: boolean;
  createdAt: string;
}

export interface InventoryLot {
  id: string;
  itemId: string;
  itemName: string;
  itemUnit: string;
  category: "reagent" | "consumable" | "control" | "standard";
  lotNumber: string;
  expiryDate: string | null;
  receivedDate: string;
  quantityReceived: string;
  quantityRemaining: string;
  status: "available" | "quarantine" | "expired" | "depleted" | "discarded";
  notes: string | null;
  createdAt: string;
}

export type WorksheetStatus = "draft" | "in_progress" | "completed" | "cancelled";

export interface WorksheetRow {
  id: string;
  worksheetNumber: string;
  status: WorksheetStatus;
  instrument: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  itemCount: number;
  reagentCount: number;
}

export interface OrderableOrder {
  id: string;
  status: string;
  serviceCode: string;
  serviceName: string;
  accessionId: string;
  sampleType: string;
}

export interface WorksheetItem {
  requestId: string;
  status: string;
  serviceCode: string;
  serviceName: string;
  accessionId: string;
  sampleType: string;
  result: {
    value: string;
    unit: string | null;
    qcStatus: "pass" | "out_of_spec" | "not_evaluated";
  } | null;
}

export interface WorksheetReagentUse {
  id: string;
  quantity: string;
  lotNumber: string;
  itemName: string;
  itemUnit: string;
  createdAt: string;
}

export interface WorksheetDetail {
  id: string;
  studyId: string;
  worksheetNumber: string;
  status: WorksheetStatus;
  instrument: string | null;
  notes: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  items: WorksheetItem[];
  reagents: WorksheetReagentUse[];
}

export interface AuditEvent {
  id: string;
  occurredAt: string;
  actorLabel: string;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  prevHash: string;
  hash: string;
}

export interface AuditPage {
  total: number;
  events: AuditEvent[];
  facets: { actions: string[]; entityTypes: string[] };
}

export interface ChainVerification {
  scope: string;
  ok: boolean;
  problems: { chainScope: string; eventId: number; problem: string }[];
}
