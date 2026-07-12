import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { api, type OrderableOrder, type WorksheetRow } from "../api.js";
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

function NewWorksheetModal({ onClose }: { onClose: () => void }) {
  const { study } = useStudy();
  const queryClient = useQueryClient();
  const orders = useQuery({
    queryKey: ["orderable-orders", study.id],
    queryFn: () => api<OrderableOrder[]>(`/studies/${study.id}/orderable-orders`),
  });
  const [instrument, setInstrument] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const create = useMutation({
    mutationFn: () =>
      api(`/studies/${study.id}/worksheets`, {
        method: "POST",
        body: JSON.stringify({
          requestIds: [...selected],
          ...(instrument ? { instrument } : {}),
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["worksheets", study.id] });
      onClose();
    },
  });

  return (
    <Modal title="Assemble a run" onClose={onClose}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (selected.size > 0) create.mutate();
        }}
        className="space-y-4"
      >
        <Field label="Instrument">
          <input
            className={inputClass}
            value={instrument}
            onChange={(e) => setInstrument(e.target.value)}
            placeholder="e.g. Cobas e411"
          />
        </Field>
        <Field label="Orders to batch">
          {orders.data?.length === 0 ? (
            <p className="rounded-lg border border-slate-200 px-3 py-4 text-center text-sm text-slate-500">
              No open orders available to batch.
            </p>
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {(orders.data ?? []).map((o) => (
                <label
                  key={o.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(o.id)}
                    onChange={() => toggle(o.id)}
                  />
                  <span className="font-mono text-slate-700">{o.accessionId}</span>
                  <span className="text-slate-500">
                    {o.serviceCode} — {o.serviceName}
                  </span>
                  <StatusBadge status={o.status} />
                </label>
              ))}
            </div>
          )}
        </Field>
        <ErrorNote message={create.error ? create.error.message : null} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={selected.size === 0 || create.isPending}>
            Create run ({selected.size})
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function WorksheetsPage() {
  const { study, permissions } = useStudy();
  const [showNew, setShowNew] = useState(false);
  const worksheets = useQuery({
    queryKey: ["worksheets", study.id],
    queryFn: () => api<WorksheetRow[]>(`/studies/${study.id}/worksheets`),
  });
  const canManage = permissions.includes("worksheet.manage");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Worksheets</h1>
          <p className="text-sm text-slate-500">
            {study.oid} — {study.name}
          </p>
        </div>
        {canManage && <Button onClick={() => setShowNew(true)}>+ Assemble run</Button>}
      </div>

      <Card>
        {worksheets.data?.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No runs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
                  <th className="px-3 py-2">Run</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Instrument</th>
                  <th className="px-3 py-2">Orders</th>
                  <th className="px-3 py-2">Reagents</th>
                  <th className="px-3 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {(worksheets.data ?? []).map((w) => (
                  <tr key={w.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-mono font-medium text-indigo-700">
                      <Link to="/worksheets/$worksheetId" params={{ worksheetId: w.id }}>
                        {w.worksheetNumber}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={w.status} />
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{w.instrument ?? "—"}</td>
                    <td className="px-3 py-2.5 text-slate-600">{w.itemCount}</td>
                    <td className="px-3 py-2.5 text-slate-600">{w.reagentCount}</td>
                    <td className="px-3 py-2.5 text-slate-500">{formatDateTime(w.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showNew && <NewWorksheetModal onClose={() => setShowNew(false)} />}
    </div>
  );
}
