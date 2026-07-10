import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { type AuditEvent, type AuditPage, api, type ChainVerification } from "../api.js";
import { useStudy } from "../app.js";
import { Button, Card, formatDateTime } from "../ui.js";

function EventRow({ event }: { event: AuditEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr
        className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
        onClick={() => setOpen(!open)}
      >
        <td className="px-3 py-2 font-mono text-xs text-slate-400">{event.id}</td>
        <td className="px-3 py-2 whitespace-nowrap text-slate-500">
          {formatDateTime(event.occurredAt)}
        </td>
        <td className="px-3 py-2">
          {event.actorLabel}
          {event.actorName && <span className="text-slate-400"> ({event.actorName})</span>}
        </td>
        <td className="px-3 py-2 font-mono text-xs">{event.action}</td>
        <td className="px-3 py-2 font-mono text-xs text-slate-500">
          {event.entityId?.slice(0, 8) ?? "—"}
        </td>
        <td className="px-3 py-2 font-mono text-[10px] text-slate-400">
          {event.hash.slice(0, 12)}…
        </td>
      </tr>
      {open && (
        <tr className="border-b border-slate-100 bg-slate-50">
          <td colSpan={6} className="px-3 py-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-semibold text-slate-500 uppercase">Before</p>
                <pre className="max-h-48 overflow-auto rounded-lg bg-white p-2 text-xs">
                  {event.before ? JSON.stringify(event.before, null, 2) : "—"}
                </pre>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold text-slate-500 uppercase">After</p>
                <pre className="max-h-48 overflow-auto rounded-lg bg-white p-2 text-xs">
                  {event.after ? JSON.stringify(event.after, null, 2) : "—"}
                </pre>
              </div>
            </div>
            <p className="mt-2 font-mono text-[10px] text-slate-400">
              prev {event.prevHash} → {event.hash}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

export function AuditTrailPage() {
  const { study } = useStudy();
  const [action, setAction] = useState("");
  const [checked, setChecked] = useState(false);

  const trail = useQuery({
    queryKey: ["audit", study.id, action],
    queryFn: () =>
      api<AuditPage>(
        `/studies/${study.id}/audit?limit=100${action ? `&action=${encodeURIComponent(action)}` : ""}`,
      ),
  });

  const verification = useQuery({
    queryKey: ["audit-verify", study.id],
    queryFn: () => api<ChainVerification>(`/studies/${study.id}/audit/verify`),
    enabled: checked,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Audit trail</h1>
          <p className="text-sm text-slate-500">Hash-chained, append-only record for {study.oid}</p>
        </div>
        <Button variant="secondary" onClick={() => setChecked(true)}>
          Verify chain integrity
        </Button>
      </div>

      {checked && verification.data && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            verification.data.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {verification.data.ok ? (
            <>
              ✅ Chain <span className="font-mono">{verification.data.scope}</span> verifies: every
              event's hash recomputes and links to its predecessor.
            </>
          ) : (
            <>
              ⚠️ Chain integrity FAILED:{" "}
              {verification.data.problems.map((p) => `event ${p.eventId}: ${p.problem}`).join("; ")}
            </>
          )}
        </div>
      )}

      <Card
        actions={
          <select
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          >
            <option value="">All actions</option>
            {(trail.data?.facets.actions ?? []).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        }
        title={`Events (${trail.data?.total ?? 0})`}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Entity</th>
                <th className="px-3 py-2">Hash</th>
              </tr>
            </thead>
            <tbody>
              {(trail.data?.events ?? []).map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
