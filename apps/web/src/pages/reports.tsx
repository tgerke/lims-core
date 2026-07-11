import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type InventoryReport, type TurnaroundReport } from "../api.js";
import { useStudy } from "../app.js";
import { Button, Card, StatusBadge } from "../ui.js";

function CountList({ rows, badge }: { rows: { key: string; count: number }[]; badge?: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-slate-500">No samples yet.</p>;
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center justify-between text-sm">
          <span className="text-slate-700">
            {badge ? <StatusBadge status={r.key} /> : r.key.replace(/_/g, " ")}
          </span>
          <span className="font-mono font-medium text-slate-900">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

function hours(v: number): string {
  if (v < 48) return `${v} h`;
  return `${Math.round((v / 24) * 10) / 10} d`;
}

function TurnaroundCard({ report }: { report: TurnaroundReport }) {
  const metrics = [
    { label: "Collection → receipt", stats: report.collectionToReceipt },
    { label: "Receipt → storage", stats: report.receiptToStorage },
  ];
  return (
    <Card title="Turnaround time">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs tracking-wide text-slate-500 uppercase">
            <th className="py-1 pr-3">Interval</th>
            <th className="py-1 pr-3 text-right">n</th>
            <th className="py-1 pr-3 text-right">Median</th>
            <th className="py-1 pr-3 text-right">Avg</th>
            <th className="py-1 text-right">Max</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr key={m.label} className="border-t border-slate-100">
              <td className="py-1.5 pr-3 text-slate-700">{m.label}</td>
              {m.stats ? (
                <>
                  <td className="py-1.5 pr-3 text-right font-mono">{m.stats.n}</td>
                  <td className="py-1.5 pr-3 text-right font-mono">{hours(m.stats.medianHours)}</td>
                  <td className="py-1.5 pr-3 text-right font-mono">{hours(m.stats.avgHours)}</td>
                  <td className="py-1.5 text-right font-mono">{hours(m.stats.maxHours)}</td>
                </>
              ) : (
                <td className="py-1.5 text-slate-400" colSpan={4}>
                  no data
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function ReportsPage() {
  const { study } = useStudy();
  const [downloading, setDownloading] = useState(false);
  const inventory = useQuery({
    queryKey: ["report-inventory", study.id],
    queryFn: () => api<InventoryReport>(`/studies/${study.id}/reports/inventory`),
  });
  const turnaround = useQuery({
    queryKey: ["report-turnaround", study.id],
    queryFn: () => api<TurnaroundReport>(`/studies/${study.id}/reports/turnaround`),
  });

  const downloadManifest = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`/api/studies/${study.id}/reports/manifest.csv`, {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("manifest export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${study.oid}-manifest.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Reports</h1>
          <p className="text-sm text-slate-500">
            {study.oid} — {study.name}
          </p>
        </div>
        <Button onClick={downloadManifest} disabled={downloading}>
          {downloading ? "Preparing…" : "Download manifest CSV"}
        </Button>
      </div>

      <Card
        title="Inventory"
        actions={
          inventory.data ? (
            <span className="text-sm text-slate-500">{inventory.data.total} samples</span>
          ) : undefined
        }
      >
        {inventory.data ? (
          <div className="grid gap-6 sm:grid-cols-3">
            <div>
              <p className="mb-2 text-xs tracking-wide text-slate-500 uppercase">By status</p>
              <CountList rows={inventory.data.byStatus} badge />
            </div>
            <div>
              <p className="mb-2 text-xs tracking-wide text-slate-500 uppercase">By type</p>
              <CountList rows={inventory.data.byType} />
            </div>
            <div>
              <p className="mb-2 text-xs tracking-wide text-slate-500 uppercase">By site</p>
              <CountList rows={inventory.data.bySite} />
            </div>
          </div>
        ) : (
          <p className="py-4 text-center text-sm text-slate-500">Loading…</p>
        )}
      </Card>

      {turnaround.data && <TurnaroundCard report={turnaround.data} />}
    </div>
  );
}
