import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import {
  type AnalysisService,
  api,
  type Order,
  type SampleDetail,
  type StorageUnit,
} from "../api.js";
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

const CUSTODY_ICONS: Record<string, string> = {
  collection: "🩸",
  receipt: "📥",
  storage_add: "🧊",
  storage_remove: "📤",
  transfer: "🚚",
  aliquot: "🧪",
  hold: "⏸️",
  hold_release: "▶️",
  disposal: "🗑️",
};

function CustodyTimeline({ sample }: { sample: SampleDetail }) {
  return (
    <Card title="Chain of custody">
      <ol className="space-y-3">
        {sample.custody.map((event) => (
          <li key={event.id} className="flex items-start gap-3 text-sm">
            <span className="mt-0.5">{CUSTODY_ICONS[event.eventType] ?? "•"}</span>
            <div>
              <p className="font-medium text-slate-800">
                {event.eventType.replace(/_/g, " ")}
                {event.storageUnit && (
                  <span className="font-normal text-slate-500">
                    {" "}
                    — {event.storageUnit}
                    {event.position ? ` · ${event.position}` : ""}
                  </span>
                )}
              </p>
              <p className="text-xs text-slate-500">
                {formatDateTime(event.occurredAt)}
                {event.actor ? ` · ${event.actor}` : ""}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function StoragePanel({ sample }: { sample: SampleDetail }) {
  const { study, permissions } = useStudy();
  const queryClient = useQueryClient();
  const units = useQuery({
    queryKey: ["storage-units", study.id],
    queryFn: () => api<StorageUnit[]>(`/studies/${study.id}/storage-units`),
  });
  const [boxId, setBoxId] = useState("");
  const [position, setPosition] = useState("");

  const store = useMutation({
    mutationFn: () =>
      api(`/samples/${sample.id}/store`, {
        method: "POST",
        body: JSON.stringify({
          storageUnitId: boxId,
          ...(position ? { position } : {}),
        }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sample", sample.id] }),
  });

  const boxes = (units.data ?? []).filter((u) => u.kind === "box");
  const pathTo = (unit: StorageUnit): string => {
    const byId = new Map((units.data ?? []).map((u) => [u.id, u]));
    const parts = [unit.name];
    let current = unit;
    while (current.parentId && byId.has(current.parentId)) {
      current = byId.get(current.parentId) as StorageUnit;
      parts.unshift(current.name);
    }
    return parts.join(" / ");
  };

  if (sample.storageUnit) {
    return (
      <Card title="Storage">
        <p className="text-sm text-slate-700">
          <span className="font-medium">{pathTo(sample.storageUnit)}</span>
          {" · position "}
          <span className="font-mono font-medium">{sample.storagePosition}</span>
        </p>
      </Card>
    );
  }

  if (!permissions.includes("sample.store")) {
    return (
      <Card title="Storage">
        <p className="text-sm text-slate-500">Not stored yet.</p>
      </Card>
    );
  }

  return (
    <Card title="Storage">
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (boxId) store.mutate();
        }}
        className="space-y-3"
      >
        <Field label="Box">
          <select className={inputClass} value={boxId} onChange={(e) => setBoxId(e.target.value)}>
            <option value="">Choose a box…</option>
            {boxes.map((b) => (
              <option key={b.id} value={b.id}>
                {pathTo(b)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Position" hint="Leave blank to auto-allocate the first free position.">
          <input
            className={inputClass}
            value={position}
            onChange={(e) => setPosition(e.target.value.toUpperCase())}
            placeholder="A1"
          />
        </Field>
        <ErrorNote message={store.error ? store.error.message : null} />
        <Button type="submit" disabled={!boxId || store.isPending}>
          Store sample
        </Button>
      </form>
    </Card>
  );
}

function formatQuantity(sample: SampleDetail): string | null {
  if (sample.quantity === null) return null;
  const unit = sample.quantityUnit ? ` ${sample.quantityUnit}` : "";
  if (sample.initialQuantity !== null && sample.initialQuantity !== sample.quantity) {
    return `${sample.quantity} of ${sample.initialQuantity}${unit}`;
  }
  return `${sample.quantity}${unit}`;
}

function LineagePanel({ sample }: { sample: SampleDetail }) {
  const { parent, children } = sample.lineage;
  if (!parent && children.length === 0) return null;
  return (
    <Card title="Lineage">
      {parent && (
        <p className="text-sm text-slate-700">
          {parent.relation} of{" "}
          <Link
            to="/samples/$sampleId"
            params={{ sampleId: parent.id }}
            className="font-mono font-medium text-indigo-700 hover:underline"
          >
            {parent.accessionId}
          </Link>
        </p>
      )}
      {children.length > 0 && (
        <div className={parent ? "mt-3" : undefined}>
          <p className="text-xs tracking-wide text-slate-500 uppercase">
            {children.length} aliquot{children.length === 1 ? "" : "s"}
          </p>
          <ul className="mt-1 space-y-1">
            {children.map((child) => (
              <li key={child.id} className="text-sm">
                <Link
                  to="/samples/$sampleId"
                  params={{ sampleId: child.id }}
                  className="font-mono font-medium text-indigo-700 hover:underline"
                >
                  {child.accessionId}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function AliquotPanel({ sample }: { sample: SampleDetail }) {
  const { permissions } = useStudy();
  const queryClient = useQueryClient();
  const [count, setCount] = useState("1");
  const [volume, setVolume] = useState("");
  const tracked = sample.quantity !== null;

  const aliquot = useMutation({
    mutationFn: () =>
      api(`/samples/${sample.id}/aliquot`, {
        method: "POST",
        body: JSON.stringify({
          count: Number(count),
          ...(volume ? { volume: Number(volume) } : {}),
        }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sample", sample.id] }),
  });

  if (!permissions.includes("sample.aliquot")) return null;
  if (sample.status === "depleted" || sample.status === "disposed") {
    return (
      <Card title="Aliquot">
        <p className="text-sm text-slate-500">Sample is {sample.status} and cannot be aliquoted.</p>
      </Card>
    );
  }

  return (
    <Card title="Aliquot">
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (Number(count) > 0) aliquot.mutate();
        }}
        className="space-y-3"
      >
        <div className="flex gap-3">
          <Field label="How many">
            <input
              className={inputClass}
              type="number"
              min="1"
              max="96"
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </Field>
          {tracked && (
            <Field
              label={`Volume each${sample.quantityUnit ? ` (${sample.quantityUnit})` : ""}`}
              hint={`${sample.quantity}${sample.quantityUnit ? ` ${sample.quantityUnit}` : ""} available`}
            >
              <input
                className={inputClass}
                type="number"
                step="any"
                min="0"
                value={volume}
                onChange={(e) => setVolume(e.target.value)}
                placeholder="0.5"
              />
            </Field>
          )}
        </div>
        <ErrorNote message={aliquot.error ? aliquot.error.message : null} />
        <Button type="submit" disabled={(tracked && !volume) || aliquot.isPending}>
          Create aliquots
        </Button>
      </form>
    </Card>
  );
}

function SignModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [meaning, setMeaning] = useState("result_release");
  const current = order.results[0];

  const sign = useMutation({
    mutationFn: () =>
      api(`/orders/${order.id}/sign`, {
        method: "POST",
        body: JSON.stringify({ password, meaning }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      onClose();
    },
  });

  return (
    <Modal title={`Sign result — ${order.serviceCode}`} onClose={onClose}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          sign.mutate();
        }}
        className="space-y-4"
      >
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Signing <span className="font-mono">{current?.value}</span>
          {current?.unit ? ` ${current.unit}` : ""} (version {current?.version}).
        </p>
        <Field label="Meaning of signature">
          <select
            className={inputClass}
            value={meaning}
            onChange={(e) => setMeaning(e.target.value)}
          >
            <option value="result_release">Result release</option>
            <option value="responsibility">Responsibility</option>
            <option value="review">Review</option>
          </select>
        </Field>
        <Field label="Password">
          <input
            className={inputClass}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
        <p className="text-xs text-slate-500">
          Re-entering your password applies your electronic signature, which is the legally binding
          equivalent of your handwritten signature (21 CFR 11.200(a)).
        </p>
        <ErrorNote message={sign.error ? sign.error.message : null} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!password || sign.isPending}>
            Apply signature
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ResultEntry({ order }: { order: Order }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState(order.serviceUnit ?? "");
  const [reason, setReason] = useState("");
  const isCorrection = order.results.length > 0;

  const enter = useMutation({
    mutationFn: () =>
      api(`/orders/${order.id}/results`, {
        method: "POST",
        body: JSON.stringify({
          value,
          ...(unit ? { unit } : {}),
          ...(reason ? { reasonForChange: reason } : {}),
        }),
      }),
    onSuccess: () => {
      setValue("");
      setReason("");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        enter.mutate();
      }}
      className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
    >
      <div className="flex gap-2">
        <input
          className={inputClass}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={isCorrection ? "Corrected value" : "Result value"}
        />
        <input
          className={`${inputClass} max-w-28`}
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          placeholder="Unit"
        />
      </div>
      {isCorrection && (
        <input
          className={inputClass}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for change (required for corrections)"
        />
      )}
      <ErrorNote message={enter.error ? enter.error.message : null} />
      <Button type="submit" disabled={!value || enter.isPending}>
        {isCorrection ? "Enter correction" : "Enter result"}
      </Button>
    </form>
  );
}

function OrderCard({ order }: { order: Order }) {
  const { permissions } = useStudy();
  const queryClient = useQueryClient();
  const [showSign, setShowSign] = useState(false);

  const verify = useMutation({
    mutationFn: () => api(`/orders/${order.id}/verify`, { method: "POST", body: "{}" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orders"] }),
  });

  const canEnter =
    permissions.includes("result.enter") &&
    (order.status === "ordered" || order.status === "resulted");
  const canVerify = permissions.includes("result.verify") && order.status === "resulted";
  const canSign = permissions.includes("result.sign") && order.status === "verified";

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-slate-900">
            {order.serviceCode}
            <span className="font-normal text-slate-500"> — {order.serviceName}</span>
          </p>
          <p className="text-xs text-slate-500">
            ordered {formatDateTime(order.createdAt)} by {order.requestedBy}
          </p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      {order.results.length > 0 && (
        <table className="mt-3 w-full text-left text-sm">
          <thead>
            <tr className="text-xs tracking-wide text-slate-500 uppercase">
              <th className="py-1 pr-3">v</th>
              <th className="py-1 pr-3">Value</th>
              <th className="py-1 pr-3">Status</th>
              <th className="py-1 pr-3">By</th>
              <th className="py-1">Reason</th>
            </tr>
          </thead>
          <tbody>
            {order.results.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="py-1.5 pr-3 font-mono text-xs">{r.version}</td>
                <td className="py-1.5 pr-3 font-mono">
                  {r.value}
                  {r.unit ? ` ${r.unit}` : ""}
                </td>
                <td className="py-1.5 pr-3">
                  <StatusBadge status={r.status} />
                </td>
                <td className="py-1.5 pr-3">{r.enteredBy}</td>
                <td className="py-1.5 text-slate-500">{r.reasonForChange ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {order.signatures.map((sig) => (
        <div
          key={sig.id}
          className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm"
        >
          <p className="font-medium text-emerald-900">
            ✍️ Signed by {sig.signerName} ({sig.signer}) — {sig.meaning.replace(/_/g, " ")}
          </p>
          <p className="text-xs text-emerald-700">
            {formatDateTime(sig.signedAt)} · bound to{" "}
            <span className="font-mono">{sig.recordHash.slice(0, 16)}…</span>
            {sig.invalidatedAt ? " · INVALIDATED" : ""}
          </p>
        </div>
      ))}

      {canEnter && <ResultEntry order={order} />}
      {(canVerify || canSign) && (
        <div className="mt-3 flex gap-2">
          {canVerify && (
            <Button variant="secondary" onClick={() => verify.mutate()} disabled={verify.isPending}>
              Verify result
            </Button>
          )}
          {canSign && <Button onClick={() => setShowSign(true)}>Sign result…</Button>}
        </div>
      )}
      <ErrorNote message={verify.error ? verify.error.message : null} />

      {showSign && <SignModal order={order} onClose={() => setShowSign(false)} />}
    </div>
  );
}

function OrdersPanel({ sample }: { sample: SampleDetail }) {
  const { permissions } = useStudy();
  const queryClient = useQueryClient();
  const orders = useQuery({
    queryKey: ["orders", sample.id],
    queryFn: () => api<Order[]>(`/samples/${sample.id}/orders`),
  });
  const services = useQuery({
    queryKey: ["services"],
    queryFn: () => api<AnalysisService[]>("/analysis-services"),
  });
  const [serviceId, setServiceId] = useState("");

  const order = useMutation({
    mutationFn: () =>
      api(`/samples/${sample.id}/orders`, {
        method: "POST",
        body: JSON.stringify({ serviceId }),
      }),
    onSuccess: () => {
      setServiceId("");
      queryClient.invalidateQueries({ queryKey: ["orders", sample.id] });
      queryClient.invalidateQueries({ queryKey: ["sample", sample.id] });
    },
  });

  return (
    <Card
      title="Tests & results"
      actions={
        permissions.includes("order.create") ? (
          <div className="flex items-center gap-2">
            <select
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
            >
              <option value="">Order a test…</option>
              {(services.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
            <Button onClick={() => order.mutate()} disabled={!serviceId || order.isPending}>
              Order
            </Button>
          </div>
        ) : undefined
      }
    >
      <ErrorNote message={order.error ? order.error.message : null} />
      {orders.data?.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">No tests ordered.</p>
      ) : (
        <div className="space-y-3">
          {(orders.data ?? []).map((o) => (
            <OrderCard key={o.id} order={o} />
          ))}
        </div>
      )}
    </Card>
  );
}

export function SampleDetailPage() {
  const { sampleId } = useParams({ from: "/app/samples/$sampleId" });
  const sample = useQuery({
    queryKey: ["sample", sampleId],
    queryFn: () => api<SampleDetail>(`/samples/${sampleId}`),
  });

  if (sample.isLoading) return <p className="text-slate-500">Loading…</p>;
  if (!sample.data) return <p className="text-slate-500">Sample not found.</p>;
  const s = sample.data;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-mono text-xl font-bold text-slate-900">{s.accessionId}</h1>
          <p className="mt-1 flex items-center gap-3 text-sm text-slate-500">
            <StatusBadge status={s.status} />
            <span>{s.sampleType.replace(/_/g, " ")}</span>
            {formatQuantity(s) && <span className="font-mono text-xs">{formatQuantity(s)}</span>}
            {s.subjectKey && <span className="font-mono text-xs">{s.subjectKey}</span>}
            {s.site && <span>{s.site.oid}</span>}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
          <img
            src={`/api/samples/${s.id}/label.png`}
            alt={`DataMatrix label for ${s.accessionId}`}
            className="h-20 w-20"
          />
          <p className="mt-1 text-center text-[10px] text-slate-500">DataMatrix</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <StoragePanel sample={s} />
          <AliquotPanel sample={s} />
          <LineagePanel sample={s} />
          <CustodyTimeline sample={s} />
        </div>
        <OrdersPanel sample={s} />
      </div>
    </div>
  );
}
