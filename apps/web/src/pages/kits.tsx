import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { api, type KitRow, type Site } from "../api.js";
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

interface ItemDraft {
  containerType: string;
  quantity: string;
}

function NewKitModal({ onClose }: { onClose: () => void }) {
  const { study } = useStudy();
  const queryClient = useQueryClient();
  const sitesQuery = useQuery({
    queryKey: ["sites", study.id],
    queryFn: () => api<Site[]>(`/studies/${study.id}/sites`),
  });
  const [destinationSiteId, setDestinationSiteId] = useState("");
  const [carrier, setCarrier] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([{ containerType: "", quantity: "" }]);

  const setItem = (idx: number, patch: Partial<ItemDraft>) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const addItem = () => setItems((prev) => [...prev, { containerType: "", quantity: "" }]);
  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const cleanItems = items
    .filter((it) => it.containerType.trim() && Number(it.quantity) > 0)
    .map((it) => ({ containerType: it.containerType.trim(), quantity: Number(it.quantity) }));

  const create = useMutation({
    mutationFn: () =>
      api(`/studies/${study.id}/kits`, {
        method: "POST",
        body: JSON.stringify({
          destinationSiteId,
          ...(carrier ? { carrier } : {}),
          ...(notes ? { notes } : {}),
          items: cleanItems,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kits", study.id] });
      onClose();
    },
  });

  return (
    <Modal title="Assemble a kit" onClose={onClose}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (destinationSiteId && cleanItems.length > 0) create.mutate();
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Destination site">
            <select
              className={inputClass}
              value={destinationSiteId}
              onChange={(e) => setDestinationSiteId(e.target.value)}
            >
              <option value="">Choose a site…</option>
              {(sitesQuery.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.oid} — {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Carrier">
            <input
              className={inputClass}
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              placeholder="World Courier"
            />
          </Field>
        </div>
        <Field label="Containers">
          <div className="space-y-2">
            {items.map((it, idx) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional drafts
              <div key={idx} className="flex gap-2">
                <input
                  className={inputClass}
                  value={it.containerType}
                  onChange={(e) => setItem(idx, { containerType: e.target.value })}
                  placeholder="EDTA tube"
                />
                <input
                  className={`${inputClass} max-w-24`}
                  type="number"
                  min="1"
                  value={it.quantity}
                  onChange={(e) => setItem(idx, { quantity: e.target.value })}
                  placeholder="Qty"
                />
                {items.length > 1 && (
                  <Button variant="secondary" onClick={() => removeItem(idx)}>
                    ✕
                  </Button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addItem}
              className="text-sm font-medium text-indigo-700 hover:underline"
            >
              + Add container
            </button>
          </div>
        </Field>
        <Field label="Notes">
          <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <ErrorNote message={create.error ? create.error.message : null} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!destinationSiteId || cleanItems.length === 0 || create.isPending}
          >
            Assemble kit
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function KitActions({ kit }: { kit: KitRow }) {
  const { study } = useStudy();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["kits", study.id] });
  const ship = useMutation({
    mutationFn: () => api(`/kits/${kit.id}/ship`, { method: "POST", body: "{}" }),
    onSuccess: invalidate,
  });
  const deliver = useMutation({
    mutationFn: () => api(`/kits/${kit.id}/deliver`, { method: "POST", body: "{}" }),
    onSuccess: invalidate,
  });

  if (kit.status === "assembled") {
    return (
      <Button variant="secondary" onClick={() => ship.mutate()} disabled={ship.isPending}>
        Ship
      </Button>
    );
  }
  if (kit.status === "shipped") {
    return (
      <Button variant="secondary" onClick={() => deliver.mutate()} disabled={deliver.isPending}>
        Mark delivered
      </Button>
    );
  }
  return null;
}

export function KitsPage() {
  const { study, permissions } = useStudy();
  const [showNew, setShowNew] = useState(false);
  const kits = useQuery({
    queryKey: ["kits", study.id],
    queryFn: () => api<KitRow[]>(`/studies/${study.id}/kits`),
  });
  const canManage = permissions.includes("kit.manage");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Collection kits</h1>
          <p className="text-sm text-slate-500">
            {study.oid} — {study.name}
          </p>
        </div>
        {canManage && <Button onClick={() => setShowNew(true)}>+ Assemble kit</Button>}
      </div>

      <Card>
        {kits.data?.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No kits yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
                  <th className="px-3 py-2">Kit</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Destination</th>
                  <th className="px-3 py-2">Contents</th>
                  <th className="px-3 py-2">Shipped</th>
                  <th className="px-3 py-2">Delivered</th>
                  {canManage && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {(kits.data ?? []).map((k) => (
                  <tr key={k.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-mono font-medium text-slate-800">
                      {k.kitNumber}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={k.status} />
                    </td>
                    <td className="px-3 py-2.5">{k.destinationSite}</td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {k.items.map((i) => `${i.quantity}× ${i.containerType}`).join(", ")}
                    </td>
                    <td className="px-3 py-2.5 text-slate-500">{formatDateTime(k.shippedAt)}</td>
                    <td className="px-3 py-2.5 text-slate-500">{formatDateTime(k.deliveredAt)}</td>
                    {canManage && (
                      <td className="px-3 py-2.5 text-right">
                        <KitActions kit={k} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showNew && <NewKitModal onClose={() => setShowNew(false)} />}
    </div>
  );
}
