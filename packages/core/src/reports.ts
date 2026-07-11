// Read-only reporting helpers (no audited writes). Pure functions so the CSV
// shape and the turnaround-time math are unit-testable without a database.

/** Summary stats over a list of durations in hours; null when the list is empty. */
export interface DurationStats {
  n: number;
  avgHours: number;
  medianHours: number;
  maxHours: number;
}

export function durationStats(hours: number[]): DurationStats | null {
  if (hours.length === 0) return null;
  const sorted = [...hours].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, h) => acc + h, 0);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
      : (sorted[mid] as number);
  const round = (x: number) => Math.round(x * 10) / 10;
  return {
    n: sorted.length,
    avgHours: round(sum / sorted.length),
    medianHours: round(median),
    maxHours: round(sorted[sorted.length - 1] as number),
  };
}

/** Hours between two instants, or null if either is missing. */
export function hoursBetween(from: Date | null, to: Date | null): number | null {
  if (!from || !to) return null;
  return (to.getTime() - from.getTime()) / 3_600_000;
}

/**
 * RFC 4180 CSV. A field is quoted when it contains a comma, quote, or newline,
 * with embedded quotes doubled. A leading =, +, -, or @ is prefixed with a
 * single quote to defuse spreadsheet formula injection from any free-text field.
 */
export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null): string => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))];
  return `${lines.join("\r\n")}\r\n`;
}

/** RFC 4180 parser: rows of fields, honoring quotes, escaped quotes, and
 * embedded commas/newlines. A trailing newline does not yield a blank row. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
