import { parseCsv } from "./reports.js";

// Parse and validate a sample-accession manifest CSV (bulk-import follow-on to
// ADR-0008). Pure: no database. The route resolves site OIDs and accessions the
// rows in one transaction only when this reports zero errors — an import is
// all-or-nothing, so a manifest never lands half-accessioned.

export interface ManifestRow {
  /** 1-based line number in the file, so the route can report site errors. */
  line: number;
  siteOid: string;
  sampleType: string;
  subjectKey?: string;
  studyEventOid?: string;
  collectedAt?: string;
}

export interface ManifestError {
  /** 1-based line number in the file (row 1 is the header). */
  row: number;
  message: string;
}

export interface ParsedManifest {
  rows: ManifestRow[];
  errors: ManifestError[];
}

const REQUIRED_COLUMNS = ["site_oid", "sample_type"];

export function parseSampleManifest(text: string, validTypes: readonly string[]): ParsedManifest {
  const table = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (table.length === 0) return { rows: [], errors: [{ row: 0, message: "manifest is empty" }] };

  const header = (table[0] as string[]).map((h) => h.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return { rows: [], errors: [{ row: 1, message: `missing column(s): ${missing.join(", ")}` }] };
  }
  const col = (cells: string[], name: string): string => {
    const i = header.indexOf(name);
    return i >= 0 && i < cells.length ? (cells[i] as string).trim() : "";
  };

  const rows: ManifestRow[] = [];
  const errors: ManifestError[] = [];
  for (let r = 1; r < table.length; r++) {
    const cells = table[r] as string[];
    const line = r + 1;
    const siteOid = col(cells, "site_oid");
    const sampleType = col(cells, "sample_type");
    const subjectKey = col(cells, "subject_key");
    const studyEventOid = col(cells, "study_event_oid");
    const collectedAtRaw = col(cells, "collected_at");

    const rowErrors: string[] = [];
    if (!siteOid) rowErrors.push("site_oid is required");
    if (!sampleType) rowErrors.push("sample_type is required");
    else if (!validTypes.includes(sampleType))
      rowErrors.push(`unknown sample_type "${sampleType}"`);

    let collectedAt: string | undefined;
    if (collectedAtRaw) {
      const d = new Date(collectedAtRaw);
      if (Number.isNaN(d.getTime())) rowErrors.push(`invalid collected_at "${collectedAtRaw}"`);
      else collectedAt = d.toISOString();
    }

    if (rowErrors.length > 0) {
      errors.push({ row: line, message: rowErrors.join("; ") });
      continue;
    }
    rows.push({
      line,
      siteOid,
      sampleType,
      ...(subjectKey ? { subjectKey } : {}),
      ...(studyEventOid ? { studyEventOid } : {}),
      ...(collectedAt ? { collectedAt } : {}),
    });
  }
  return { rows, errors };
}
