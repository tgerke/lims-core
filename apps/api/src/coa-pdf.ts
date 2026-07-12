import type { CoaSnapshot } from "@lims-core/core";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

// Renders a Certificate of Analysis snapshot (ADR-0022) to a PDF. The content is
// strictly factual — identifiers, analytes, verdicts, issuer, and the content
// hash. It deliberately asserts no regulatory/accreditation claim (project hard
// rule: never state regulatory specifics not grounded in source).

const MARGIN = 50;
const PAGE_WIDTH = 595.28; // A4 portrait, points
const PAGE_HEIGHT = 841.89;

const QC_LABEL: Record<string, string> = {
  pass: "In spec",
  out_of_spec: "OUT OF SPEC",
  not_evaluated: "—",
};

export async function renderCoaPdf(
  snapshot: CoaSnapshot,
  meta: { coaNumber: string; contentHash: string },
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Certificate of Analysis ${meta.coaNumber}`);
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.09, 0.11, 0.15);
  const muted = rgb(0.42, 0.45, 0.5);
  const rule = rgb(0.8, 0.82, 0.85);

  let y = PAGE_HEIGHT - MARGIN;
  const line = (
    text: string,
    opts: { size?: number; font?: typeof font; color?: typeof ink } = {},
  ) => {
    const size = opts.size ?? 10;
    page.drawText(text, { x: MARGIN, y, size, font: opts.font ?? font, color: opts.color ?? ink });
    y -= size + 6;
  };
  const label = (text: string, value: string) => {
    page.drawText(text, { x: MARGIN, y, size: 10, font: bold, color: muted });
    page.drawText(value, { x: MARGIN + 130, y, size: 10, font, color: ink });
    y -= 16;
  };
  const hr = () => {
    y -= 2;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_WIDTH - MARGIN, y },
      thickness: 0.75,
      color: rule,
    });
    y -= 14;
  };

  line("CERTIFICATE OF ANALYSIS", { size: 18, font: bold });
  line(meta.coaNumber, { size: 11, color: muted });
  y -= 6;
  hr();

  label("Study", `${snapshot.study.name} (${snapshot.study.oid})`);
  label("Sample", `${snapshot.sample.accessionId} · ${snapshot.sample.sampleType}`);
  if (snapshot.sample.subjectKey) label("Subject", snapshot.sample.subjectKey);
  label("Issued", new Date(snapshot.issuedAt).toUTCString());
  label(
    "Issued by",
    snapshot.issuedBy.fullName
      ? `${snapshot.issuedBy.fullName} (${snapshot.issuedBy.username})`
      : snapshot.issuedBy.username,
  );
  y -= 4;
  hr();

  // Results table header.
  const cols = { code: MARGIN, name: MARGIN + 70, value: MARGIN + 250, qc: MARGIN + 370 };
  page.drawText("ANALYTE", { x: cols.code, y, size: 8, font: bold, color: muted });
  page.drawText("NAME", { x: cols.name, y, size: 8, font: bold, color: muted });
  page.drawText("RESULT", { x: cols.value, y, size: 8, font: bold, color: muted });
  page.drawText("QC", { x: cols.qc, y, size: 8, font: bold, color: muted });
  y -= 14;

  for (const a of snapshot.analytes) {
    const valueText = `${a.value}${a.unit ? ` ${a.unit}` : ""}${a.source === "calculated" ? " (calc)" : ""}`;
    const qcText = QC_LABEL[a.qcStatus] ?? a.qcStatus;
    const qcColor = a.qcStatus === "out_of_spec" ? rgb(0.7, 0.1, 0.2) : ink;
    page.drawText(a.serviceCode, { x: cols.code, y, size: 9, font, color: ink });
    page.drawText(truncate(a.serviceName, 30), { x: cols.name, y, size: 9, font, color: ink });
    page.drawText(valueText, { x: cols.value, y, size: 9, font, color: ink });
    page.drawText(qcText, { x: cols.qc, y, size: 9, font, color: qcColor });
    y -= 14;
  }

  y -= 6;
  hr();
  line(
    "This certificate reflects the released results recorded for the sample above at the time of issue.",
    { size: 8, color: muted },
  );
  line(`Integrity hash (sha256): ${meta.contentHash}`, { size: 8, color: muted });

  return pdf.save();
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
