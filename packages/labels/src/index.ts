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

export const ACCESSION_ID_PATTERN = /^[A-Z0-9][A-Z0-9-]*-\d{5,}$/;

export function isAccessionId(value: string): boolean {
  return ACCESSION_ID_PATTERN.test(value);
}
