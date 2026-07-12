import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { api, type InventoryLot, type WorksheetDetail } from "../api.js";
import { useStudy } from "../app.js";
import {
  Button,
  Card,
  ErrorNote,
  Field,
  formatDateTime,
  inputClass,
  Modal,
  StatusBadge,
} from "../ui.js";

function AddReagentModal({ worksheetId, onClose }: { worksheetId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const lots = useQuery({
    queryKey: ["inventory-lots"],
    queryFn: () => api<InventoryLot[]>("/inventory/lots"),
  });
  const available = (lots.data ?? []).filter((l) => l.status === "available");
  const [lotId, setLotId] = useState("");
  const [quantity, setQuantity] = useState("");

  const record = useMutation({
    mutationFn: () =>
      api(`/worksheets/${worksheetId}/reagents`, {
        method: "POST",
        body: JSON.stringify({ lotId, quantity: Number(quantity) }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["worksheet", worksheetId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-lots"] });
      onClose();
    },
  });

  const valid = lotId !== "" && Number(quantity) > 0;

  return (
    <Modal title="Record reagent use" onClose={onClose}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (valid) record.mutate();
        }}
        className="space-y-4"
      >
        <Field label="Lot">
          <select className={inputClass} value={lotId} onChange={(e) => setLotId(e.target.value)}>
            <option value="">Choose an available lot…</option>
            {available.map((l) => (
              <option key={l.id} value={l.id}>
                {l.itemName} · {l.lotNumber} ({Number(l.quantityRemaining)} {l.itemUnit} left)
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quantity drawn">
          <input
            className={inputClass}
            type="number"
            min="0"
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
        <ErrorNote message={record.error ? record.error.message : null} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid || record.isPending}>
            Record use
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function WorksheetDetailPage() {
  const { worksheetId } = useParams({ from: "/app/worksheets/$worksheetId" });
  const { permissions } = useStudy();
  const queryClient = useQueryClient();
  const [showReagent, setShowReagent] = useState(false);
  const ws = useQuery({
    queryKey: ["worksheet", worksheetId],
    queryFn: () => api<WorksheetDetail>(`/worksheets/${worksheetId}`),
  });

  const canManage = permissions.includes("worksheet.manage");
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["worksheet", worksheetId] });
  const start = useMutation({
    mutationFn: () => api(`/worksheets/${worksheetId}/start`, { method: "POST", body: "{}" }),
    onSuccess: invalidate,
  });
  const complete = useMutation({
    mutationFn: () => api(`/worksheets/${worksheetId}/complete`, { method: "POST", body: "{}" }),
    onSuccess: invalidate,
  });

  if (ws.isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!ws.data) return <p className="text-sm text-slate-500">Worksheet not found.</p>;
  const w = ws.data;
  const open = w.status === "draft" || w.status === "in_progress";

  return (
    <div className="space-y-6">
      <div>
        <Link to="/worksheets" className="text-sm text-indigo-600 hover:underline">
          ← Worksheets
        </Link>
        <div className="mt-2 flex items-center justify-between">
          <div>
            <h1 className="font-mono text-xl font-bold text-slate-900">{w.worksheetNumber}</h1>
            <p className="text-sm text-slate-500">
              {w.instrument ?? "No instrument"} · created {formatDateTime(w.createdAt)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={w.status} />
            {canManage && w.status === "draft" && (
              <Button onClick={() => start.mutate()} disabled={start.isPending}>
                Start run
              </Button>
            )}
            {canManage && w.status === "in_progress" && (
              <Button onClick={() => complete.mutate()} disabled={complete.isPending}>
                Complete run
              </Button>
            )}
          </div>
        </div>
        <ErrorNote message={start.error?.message ?? complete.error?.message ?? null} />
      </div>

      <Card title="Orders">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
                <th className="px-3 py-2">Sample</th>
                <th className="px-3 py-2">Assay</th>
                <th className="px-3 py-2">Order</th>
                <th className="px-3 py-2">Result</th>
                <th className="px-3 py-2">QC</th>
              </tr>
            </thead>
            <tbody>
              {w.items.map((it) => (
                <tr key={it.requestId} className="border-b border-slate-100">
                  <td className="px-3 py-2.5 font-mono text-slate-700">{it.accessionId}</td>
                  <td className="px-3 py-2.5 text-slate-600">
                    {it.serviceCode} — {it.serviceName}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={it.status} />
                  </td>
                  <td className="px-3 py-2.5 font-mono text-slate-700">
                    {it.result
                      ? `${it.result.value}${it.result.unit ? ` ${it.result.unit}` : ""}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    {it.result ? <StatusBadge status={it.result.qcStatus} /> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Reagents consumed"
        actions={
          canManage && open ? (
            <Button variant="secondary" onClick={() => setShowReagent(true)}>
              + Record use
            </Button>
          ) : undefined
        }
      >
        {w.reagents.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">No reagents recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
                  <th className="px-3 py-2">Reagent</th>
                  <th className="px-3 py-2">Lot</th>
                  <th className="px-3 py-2">Quantity</th>
                  <th className="px-3 py-2">Recorded</th>
                </tr>
              </thead>
              <tbody>
                {w.reagents.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="px-3 py-2.5 text-slate-700">{r.itemName}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-600">{r.lotNumber}</td>
                    <td className="px-3 py-2.5 text-slate-700">
                      {Number(r.quantity)} {r.itemUnit}
                    </td>
                    <td className="px-3 py-2.5 text-slate-500">{formatDateTime(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showReagent && (
        <AddReagentModal worksheetId={worksheetId} onClose={() => setShowReagent(false)} />
      )}
    </div>
  );
}
