import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { api, type SampleRow, type ShipmentRow, type Site } from "../api.js";
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

// Only available samples can be packed; must match SHIPPABLE_STATUSES in core.
const SHIPPABLE = new Set(["registered", "in_storage", "in_testing"]);

function NewShipmentModal({ onClose }: { onClose: () => void }) {
  const { study } = useStudy();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sitesQuery = useQuery({
    queryKey: ["sites", study.id],
    queryFn: () => api<Site[]>(`/studies/${study.id}/sites`),
  });
  const samplesQuery = useQuery({
    queryKey: ["samples", study.id],
    queryFn: () => api<SampleRow[]>(`/studies/${study.id}/samples`),
  });
  const [destination, setDestination] = useState("");
  const [originSiteId, setOriginSiteId] = useState("");
  const [carrier, setCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const eligible = (samplesQuery.data ?? []).filter((s) => SHIPPABLE.has(s.status));
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const create = useMutation({
    mutationFn: () =>
      api<{ id: string }>(`/studies/${study.id}/shipments`, {
        method: "POST",
        body: JSON.stringify({
          destination,
          ...(originSiteId ? { originSiteId } : {}),
          ...(carrier ? { carrier } : {}),
          ...(trackingNumber ? { trackingNumber } : {}),
          sampleIds: [...picked],
        }),
      }),
    onSuccess: (shipment) => {
      queryClient.invalidateQueries({ queryKey: ["shipments", study.id] });
      onClose();
      navigate({ to: "/shipments/$shipmentId", params: { shipmentId: shipment.id } });
    },
  });

  return (
    <Modal title="Pack a shipment" onClose={onClose}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (destination && picked.size > 0) create.mutate();
        }}
        className="space-y-4"
      >
        <Field label="Destination">
          <input
            className={inputClass}
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="Central Biorepository"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Origin site">
            <select
              className={inputClass}
              value={originSiteId}
              onChange={(e) => setOriginSiteId(e.target.value)}
            >
              <option value="">—</option>
              {(sitesQuery.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.oid}
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
        <Field label="Tracking number">
          <input
            className={inputClass}
            value={trackingNumber}
            onChange={(e) => setTrackingNumber(e.target.value)}
          />
        </Field>
        <Field
          label={`Samples (${picked.size} selected)`}
          hint="Only available samples are listed."
        >
          <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-200">
            {eligible.length === 0 ? (
              <p className="p-3 text-sm text-slate-500">No available samples to ship.</p>
            ) : (
              eligible.map((s) => (
                <label
                  key={s.id}
                  className="flex cursor-pointer items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm last:border-0 hover:bg-slate-50"
                >
                  <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
                  <span className="font-mono">{s.accessionId}</span>
                  <span className="text-slate-500">{s.sampleType.replace(/_/g, " ")}</span>
                  <StatusBadge status={s.status} />
                </label>
              ))
            )}
          </div>
        </Field>
        <ErrorNote message={create.error ? create.error.message : null} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!destination || picked.size === 0 || create.isPending}>
            Pack shipment
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ShipmentsPage() {
  const { study, permissions } = useStudy();
  const [showNew, setShowNew] = useState(false);
  const shipments = useQuery({
    queryKey: ["shipments", study.id],
    queryFn: () => api<ShipmentRow[]>(`/studies/${study.id}/shipments`),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Shipments</h1>
          <p className="text-sm text-slate-500">
            {study.oid} — {study.name}
          </p>
        </div>
        {permissions.includes("shipment.send") && (
          <Button onClick={() => setShowNew(true)}>+ Pack shipment</Button>
        )}
      </div>

      <Card>
        {shipments.data?.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No shipments yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
                  <th className="px-3 py-2">Shipment</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Origin</th>
                  <th className="px-3 py-2">Destination</th>
                  <th className="px-3 py-2">Samples</th>
                  <th className="px-3 py-2">Shipped</th>
                  <th className="px-3 py-2">Received</th>
                </tr>
              </thead>
              <tbody>
                {(shipments.data ?? []).map((s) => (
                  <tr key={s.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2.5">
                      <Link
                        to="/shipments/$shipmentId"
                        params={{ shipmentId: s.id }}
                        className="font-mono font-medium text-indigo-700 hover:underline"
                      >
                        {s.shipmentNumber}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="px-3 py-2.5">{s.originSite ?? "—"}</td>
                    <td className="px-3 py-2.5">{s.destination}</td>
                    <td className="px-3 py-2.5">{s.itemCount}</td>
                    <td className="px-3 py-2.5 text-slate-500">{formatDateTime(s.shippedAt)}</td>
                    <td className="px-3 py-2.5 text-slate-500">{formatDateTime(s.receivedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showNew && <NewShipmentModal onClose={() => setShowNew(false)} />}
    </div>
  );
}
