// Accession identity helpers are isomorphic (client + server). The DataMatrix
// renderer lives in ./datamatrix so the web bundle never pulls in bwip-js
// (ADR-0004) unless it renders labels itself.

/** `STUDY-001-00042`: sanitized study OID + zero-padded per-study number. */
export function formatAccessionId(studyOid: string, sequence: number): string {
  const prefix = studyOid
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${prefix}-${String(sequence).padStart(5, "0")}`;
}

/** `PARENT.1`: an aliquot's id is its parent's id plus a 1-based ordinal, so
 * lineage is legible in the accession id itself (ADR-0006). */
export function formatAliquotId(parentAccessionId: string, ordinal: number): string {
  return `${parentAccessionId}.${ordinal}`;
}

// Trailing `.\d+` is an aliquot suffix (formatAliquotId).
export const ACCESSION_ID_PATTERN = /^[A-Z0-9][A-Z0-9-]*-\d{5,}(\.\d+)?$/;

export function isAccessionId(value: string): boolean {
  return ACCESSION_ID_PATTERN.test(value);
}
