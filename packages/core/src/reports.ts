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
