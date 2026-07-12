import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  api,
  type ControlSeries,
  type ControlSeriesPoint,
  type QcControlSummary,
  type QcVerdict,
} from "../api.js";
import { Card, formatDateTime, StatusBadge } from "../ui.js";

const VERDICT_FILL: Record<QcVerdict, string> = {
  accept: "#059669",
  warning: "#d97706",
  reject: "#e11d48",
};

function fmtZ(z: number): string {
  return `${z >= 0 ? "+" : ""}${z.toFixed(2)}`;
}

// Levey-Jennings plot: z-score (value in SD units from the control's mean) over
// time, with ±1/±2/±3 SD reference bands. Points are colored by the frozen
// Westgard verdict and a rejecting point is annotated with the rule that fired.
function LeveyJennings({ points }: { points: ControlSeriesPoint[] }) {
  if (points.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">No measurements yet.</p>;
  }

  const W = 760;
  const H = 320;
  const padL = 48;
  const padR = 16;
  const padT = 20;
  const padB = 44;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const zs = points.map((p) => Number(p.zScore));
  // Always show ±3 SD (the Westgard reference range); expand to whole SDs only
  // when a point runs past it, so an in-control chart isn't dwarfed by headroom.
  const zMax = Math.max(3, ...zs.map((z) => Math.ceil(Math.abs(z))));

  const x = (i: number) =>
    padL + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (z: number) => padT + ((zMax - z) / (2 * zMax)) * plotH;

  // Faint SD bands, outer-first so inner draws on top.
  const bands = [
    { from: 2, to: zMax, fill: "#fff1f2" }, // >2 SD, rose tint
    { from: 1, to: 2, fill: "#fffbeb" }, // 1–2 SD, amber tint
    { from: 0, to: 1, fill: "#ecfdf5" }, // <1 SD, emerald tint
  ];
  const gridZ: number[] = [];
  for (let z = -zMax; z <= zMax; z++) gridZ.push(z);

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(Number(p.zScore))}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Levey-Jennings QC chart"
    >
      <title>Levey-Jennings control chart: z-score over time</title>
      {bands.map((b) => (
        <g key={b.from}>
          <rect x={padL} y={y(b.to)} width={plotW} height={y(b.from) - y(b.to)} fill={b.fill} />
          <rect
            x={padL}
            y={y(-b.from)}
            width={plotW}
            height={y(-b.to) - y(-b.from)}
            fill={b.fill}
          />
        </g>
      ))}

      {gridZ.map((z) => (
        <g key={z}>
          <line
            x1={padL}
            x2={W - padR}
            y1={y(z)}
            y2={y(z)}
            stroke={z === 0 ? "#94a3b8" : "#e2e8f0"}
            strokeWidth={z === 0 ? 1.5 : 1}
          />
          <text x={padL - 8} y={y(z) + 3.5} textAnchor="end" fontSize={11} fill="#64748b">
            {z > 0 ? `+${z}` : z}
          </text>
        </g>
      ))}
      <text
        x={14}
        y={padT + plotH / 2}
        fontSize={11}
        fill="#64748b"
        textAnchor="middle"
        transform={`rotate(-90 14 ${padT + plotH / 2})`}
      >
        SD from mean
      </text>

      <path d={linePath} fill="none" stroke="#cbd5e1" strokeWidth={1.5} />

      {points.map((p, i) => {
        const z = Number(p.zScore);
        return (
          <g key={p.id}>
            <circle
              cx={x(i)}
              cy={y(z)}
              r={4.5}
              fill={VERDICT_FILL[p.verdict]}
              stroke="white"
              strokeWidth={1}
            >
              <title>{`${formatDateTime(p.createdAt)} · value ${p.value} · z ${fmtZ(z)} · ${p.verdict}${p.rule ? ` (${p.rule})` : ""}`}</title>
            </circle>
            {p.verdict === "reject" && p.rule && (
              <text
                x={x(i)}
                y={y(z) - 9}
                textAnchor="middle"
                fontSize={10}
                fontWeight={600}
                fill="#e11d48"
              >
                {p.rule}
              </text>
            )}
          </g>
        );
      })}

      {[0, points.length - 1]
        .filter((i, idx, a) => a.indexOf(i) === idx)
        .map((i) => {
          const p = points[i];
          if (!p) return null;
          return (
            <text key={i} x={x(i)} y={H - 24} textAnchor="middle" fontSize={10} fill="#64748b">
              {new Date(p.createdAt).toLocaleDateString()}
            </text>
          );
        })}
      <text x={padL + plotW / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="#64748b">
        measurement order (oldest → newest)
      </text>
    </svg>
  );
}

function ControlChart({ controlId }: { controlId: string }) {
  const series = useQuery({
    queryKey: ["control-series", controlId],
    queryFn: () => api<ControlSeries>(`/control-materials/${controlId}/series`),
  });

  if (!series.data) return <p className="py-8 text-center text-sm text-slate-500">Loading…</p>;
  const { control, points } = series.data;
  return (
    <Card
      title={`${control.serviceCode} — ${control.level}`}
      actions={
        <span className="text-sm text-slate-500">
          target {control.targetMean} ± {control.targetSd}
          {control.unit ? ` ${control.unit}` : ""} · lot {control.lotNumber}
        </span>
      }
    >
      <LeveyJennings points={points} />
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-600" /> accept
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-600" /> warning
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-rose-600" /> reject
        </span>
      </div>
    </Card>
  );
}

export function QcReviewPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const summary = useQuery({
    queryKey: ["qc-review"],
    queryFn: () => api<QcControlSummary[]>("/qc-review"),
  });

  const controls = summary.data ?? [];
  const active = selected ?? controls.find((c) => c.n > 0)?.controlMaterialId ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">QC review</h1>
        <p className="text-sm text-slate-500">
          Control performance across the lab — latest Westgard verdict per active control, and the
          Levey-Jennings trend behind it.
        </p>
      </div>

      <Card title="Active controls">
        {controls.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">
            {summary.isLoading ? "Loading…" : "No active control materials."}
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs tracking-wide text-slate-500 uppercase">
                <th className="py-1 pr-3">Service</th>
                <th className="py-1 pr-3">Level</th>
                <th className="py-1 pr-3">Lot</th>
                <th className="py-1 pr-3 text-right">n</th>
                <th className="py-1 pr-3 text-right">Latest z</th>
                <th className="py-1 pr-3">Latest</th>
                <th className="py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {controls.map((c) => (
                <tr
                  key={c.controlMaterialId}
                  onClick={() => setSelected(c.controlMaterialId)}
                  className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${
                    c.controlMaterialId === active ? "bg-indigo-50/60" : ""
                  }`}
                >
                  <td className="py-1.5 pr-3 text-slate-700">
                    {c.serviceCode}
                    <span className="text-slate-400"> · {c.serviceName}</span>
                  </td>
                  <td className="py-1.5 pr-3 text-slate-700">{c.level}</td>
                  <td className="py-1.5 pr-3 font-mono text-xs text-slate-500">{c.lotNumber}</td>
                  <td className="py-1.5 pr-3 text-right font-mono">{c.n}</td>
                  <td className="py-1.5 pr-3 text-right font-mono">
                    {c.latestZ === null ? "—" : fmtZ(Number(c.latestZ))}
                  </td>
                  <td className="py-1.5 pr-3 text-xs text-slate-500">
                    {formatDateTime(c.latestAt)}
                  </td>
                  <td className="py-1.5">
                    {c.latestVerdict ? (
                      <span className="flex items-center gap-1.5">
                        <StatusBadge status={c.latestVerdict} />
                        {c.latestRule && (
                          <span className="font-mono text-xs text-slate-400">{c.latestRule}</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">no data</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {active && <ControlChart controlId={active} />}
    </div>
  );
}
