import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { api, type ShipmentDetail } from "../api.js";
import { useStudy } from "../app.js";
import { Button, Card, ErrorNote, formatDateTime, StatusBadge } from "../ui.js";

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="text-sm text-slate-800">{value}</dd>
    </div>
  );
}

function Actions({ shipment }: { shipment: ShipmentDetail }) {
  const { permissions } = useStudy();
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["shipment", shipment.id] });
    queryClient.invalidateQueries({ queryKey: ["shipments"] });
  };

  const ship = useMutation({
    mutationFn: () => api(`/shipments/${shipment.id}/ship`, { method: "POST", body: "{}" }),
    onSuccess: invalidate,
  });
  const receive = useMutation({
    mutationFn: () => api(`/shipments/${shipment.id}/receive`, { method: "POST", body: "{}" }),
    onSuccess: invalidate,
  });

  const canShip = permissions.includes("shipment.send") && shipment.status === "packed";
  const canReceive = permissions.includes("shipment.receive") && shipment.status === "in_transit";
  if (!canShip && !canReceive) return null;

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {canShip && (
          <Button onClick={() => ship.mutate()} disabled={ship.isPending}>
            Mark shipped
          </Button>
        )}
        {canReceive && (
          <Button onClick={() => receive.mutate()} disabled={receive.isPending}>
            Receive shipment
          </Button>
        )}
      </div>
      <ErrorNote message={ship.error?.message ?? receive.error?.message ?? null} />
    </div>
  );
}

export function ShipmentDetailPage() {
  const { shipmentId } = useParams({ from: "/app/shipments/$shipmentId" });
  const shipment = useQuery({
    queryKey: ["shipment", shipmentId],
    queryFn: () => api<ShipmentDetail>(`/shipments/${shipmentId}`),
  });

  if (shipment.isLoading) return <p className="text-slate-500">Loading…</p>;
  if (!shipment.data) return <p className="text-slate-500">Shipment not found.</p>;
  const s = shipment.data;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-mono text-xl font-bold text-slate-900">{s.shipmentNumber}</h1>
          <p className="mt-1 flex items-center gap-3 text-sm text-slate-500">
            <StatusBadge status={s.status} />
            <span>
              {s.originSite ? s.originSite.oid : "—"} → {s.destination}
            </span>
          </p>
        </div>
        <Actions shipment={s} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Shipment">
          <dl className="grid grid-cols-2 gap-4">
            <Detail label="Carrier" value={s.carrier ?? "—"} />
            <Detail label="Tracking" value={s.trackingNumber ?? "—"} />
            <Detail
              label="Packed"
              value={`${formatDateTime(s.createdAt)}${s.createdBy ? ` · ${s.createdBy}` : ""}`}
            />
            <Detail label="Shipped" value={formatDateTime(s.shippedAt)} />
            <Detail label="Received" value={formatDateTime(s.receivedAt)} />
          </dl>
        </Card>

        <Card title={`Contents (${s.items.length})`}>
          <ul className="space-y-2">
            {s.items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 text-sm">
                <Link
                  to="/samples/$sampleId"
                  params={{ sampleId: item.id }}
                  className="font-mono font-medium text-indigo-700 hover:underline"
                >
                  {item.accessionId}
                </Link>
                <span className="text-slate-500">{item.sampleType.replace(/_/g, " ")}</span>
                <StatusBadge status={item.status} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
