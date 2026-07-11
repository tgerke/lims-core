import { SAMPLE_TYPES } from "@lims-core/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { api, type SampleRow, type Site, type StorageUnit } from "../api.js";
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

function AccessionModal({ onClose }: { onClose: () => void }) {
  const { study } = useStudy();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sitesQuery = useQuery({
    queryKey: ["sites", study.id],
    queryFn: () => api<Site[]>(`/studies/${study.id}/sites`),
  });
  const [siteId, setSiteId] = useState("");
  const [sampleType, setSampleType] = useState<string>("serum");
  const [subjectKey, setSubjectKey] = useState("");
  const [collectedAt, setCollectedAt] = useState("");

  const accession = useMutation({
    mutationFn: () =>
      api<{ id: string }>(`/studies/${study.id}/samples`, {
        method: "POST",
        body: JSON.stringify({
          siteId: siteId || sitesQuery.data?.[0]?.id,
          sampleType,
          ...(subjectKey ? { subjectKey } : {}),
          ...(collectedAt ? { collectedAt: new Date(collectedAt).toISOString() } : {}),
        }),
      }),
    onSuccess: (sample) => {
      queryClient.invalidateQueries({ queryKey: ["samples", study.id] });
      onClose();
      navigate({ to: "/samples/$sampleId", params: { sampleId: sample.id } });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    accession.mutate();
  };

  return (
    <Modal title="Accession a sample" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Site">
          <select
            className={inputClass}
            value={siteId || (sitesQuery.data?.[0]?.id ?? "")}
            onChange={(e) => setSiteId(e.target.value)}
          >
            {(sitesQuery.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.oid} — {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sample type">
          <select
            className={inputClass}
            value={sampleType}
            onChange={(e) => setSampleType(e.target.value)}
          >
            {SAMPLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Subject key (EDC reference)" hint="Reference only — never PHI.">
          <input
            className={inputClass}
            value={subjectKey}
            onChange={(e) => setSubjectKey(e.target.value)}
            placeholder="SUBJ-001"
          />
        </Field>
        <Field label="Collected at">
          <input
            className={inputClass}
            type="datetime-local"
            value={collectedAt}
            onChange={(e) => setCollectedAt(e.target.value)}
          />
        </Field>
        <ErrorNote message={accession.error ? accession.error.message : null} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={accession.isPending}>
            Accession
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function BulkAccessionModal({ onClose }: { onClose: () => void }) {
  const { study } = useStudy();
  const queryClient = useQueryClient();
  const sitesQuery = useQuery({
    queryKey: ["sites", study.id],
    queryFn: () => api<Site[]>(`/studies/${study.id}/sites`),
  });
  const unitsQuery = useQuery({
    queryKey: ["storage-units", study.id],
    queryFn: () => api<StorageUnit[]>(`/studies/${study.id}/storage-units`),
  });
  const [siteId, setSiteId] = useState("");
  const [sampleType, setSampleType] = useState<string>("serum");
  const [count, setCount] = useState("12");
  const [subjectKey, setSubjectKey] = useState("");
  const [storageUnitId, setStorageUnitId] = useState("");

  const boxes = (unitsQuery.data ?? []).filter((u) => u.kind === "box");
  const pathTo = (unit: StorageUnit): string => {
    const byId = new Map((unitsQuery.data ?? []).map((u) => [u.id, u]));
    const parts = [unit.name];
    let current = unit;
    while (current.parentId && byId.has(current.parentId)) {
      current = byId.get(current.parentId) as StorageUnit;
      parts.unshift(current.name);
    }
    return parts.join(" / ");
  };

  const bulk = useMutation({
    mutationFn: () =>
      api<{ count: number }>(`/studies/${study.id}/samples/bulk`, {
        method: "POST",
        body: JSON.stringify({
          siteId: siteId || sitesQuery.data?.[0]?.id,
          sampleType,
          count: Number(count),
          ...(subjectKey ? { subjectKey } : {}),
          ...(storageUnitId ? { storageUnitId } : {}),
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["samples", study.id] });
      onClose();
    },
  });

  return (
    <Modal title="Bulk accession" onClose={onClose}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (Number(count) > 0) bulk.mutate();
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Site">
            <select
              className={inputClass}
              value={siteId || (sitesQuery.data?.[0]?.id ?? "")}
              onChange={(e) => setSiteId(e.target.value)}
            >
              {(sitesQuery.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.oid} — {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="How many" hint="1–96">
            <input
              className={inputClass}
              type="number"
              min="1"
              max="96"
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Sample type">
          <select
            className={inputClass}
            value={sampleType}
            onChange={(e) => setSampleType(e.target.value)}
          >
            {SAMPLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Subject key (EDC reference)" hint="Optional; applied to every sample.">
          <input
            className={inputClass}
            value={subjectKey}
            onChange={(e) => setSubjectKey(e.target.value)}
            placeholder="SUBJ-001"
          />
        </Field>
        <Field
          label="Fill box (optional)"
          hint="Places the batch sequentially from the first free position."
        >
          <select
            className={inputClass}
            value={storageUnitId}
            onChange={(e) => setStorageUnitId(e.target.value)}
          >
            <option value="">Don't store yet</option>
            {boxes.map((b) => (
              <option key={b.id} value={b.id}>
                {pathTo(b)}
              </option>
            ))}
          </select>
        </Field>
        <ErrorNote message={bulk.error ? bulk.error.message : null} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={bulk.isPending}>
            Accession {count || 0}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ImportModal({ onClose }: { onClose: () => void }) {
  const { study } = useStudy();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [rowErrors, setRowErrors] = useState<{ row: number; message: string }[]>([]);

  const runImport = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("choose a CSV file");
      const csv = await file.text();
      const res = await fetch(`/api/studies/${study.id}/samples/import`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const body = (await res.json()) as {
        error?: string;
        errors?: { row: number; message: string }[];
        count?: number;
      };
      if (!res.ok) {
        setRowErrors(body.errors ?? []);
        throw new Error(body.error ?? "import failed");
      }
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["samples", study.id] });
      onClose();
    },
  });

  return (
    <Modal title="Import a sample manifest" onClose={onClose}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setRowErrors([]);
          if (file) runImport.mutate();
        }}
        className="space-y-4"
      >
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          CSV columns: <span className="font-mono">site_oid</span>,{" "}
          <span className="font-mono">sample_type</span> (required);{" "}
          <span className="font-mono">subject_key</span>,{" "}
          <span className="font-mono">study_event_oid</span>,{" "}
          <span className="font-mono">collected_at</span> (optional). One bad row rejects the whole
          file.
        </p>
        <Field label="Manifest file">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-indigo-700"
          />
        </Field>
        <ErrorNote message={runImport.error ? runImport.error.message : null} />
        {rowErrors.length > 0 && (
          <div className="max-h-40 overflow-y-auto rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            <ul className="space-y-1">
              {rowErrors.map((e) => (
                <li key={`${e.row}-${e.message}`}>
                  <span className="font-mono">row {e.row}</span>: {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!file || runImport.isPending}>
            Import
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// Pool two or more available samples into one specimen (ADR-0014).
const POOLABLE = new Set(["registered", "in_storage", "in_testing"]);

function PoolModal({ onClose }: { onClose: () => void }) {
  const { study } = useStudy();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const samplesQuery = useQuery({
    queryKey: ["samples", study.id],
    queryFn: () => api<SampleRow[]>(`/studies/${study.id}/samples`),
  });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pooledType, setPooledType] = useState("");

  const eligible = (samplesQuery.data ?? []).filter((s) => POOLABLE.has(s.status));
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const pool = useMutation({
    mutationFn: () =>
      api<{ pooled: { id: string } }>(`/studies/${study.id}/samples/pool`, {
        method: "POST",
        body: JSON.stringify({
          parentIds: [...picked],
          ...(pooledType ? { pooledType } : {}),
        }),
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["samples", study.id] });
      onClose();
      navigate({ to: "/samples/$sampleId", params: { sampleId: result.pooled.id } });
    },
  });

  return (
    <Modal title="Pool samples" onClose={onClose}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (picked.size >= 2) pool.mutate();
        }}
        className="space-y-4"
      >
        <Field label="Pooled type" hint="Leave blank to inherit when all sources share a type.">
          <select
            className={inputClass}
            value={pooledType}
            onChange={(e) => setPooledType(e.target.value)}
          >
            <option value="">Same as sources</option>
            {SAMPLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={`Sources (${picked.size} selected)`}
          hint="Pick at least two available samples."
        >
          <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-200">
            {eligible.length === 0 ? (
              <p className="p-3 text-sm text-slate-500">No available samples to pool.</p>
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
        <ErrorNote message={pool.error ? pool.error.message : null} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={picked.size < 2 || pool.isPending}>
            Pool {picked.size > 0 ? picked.size : ""} samples
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function SamplesPage() {
  const { study, permissions } = useStudy();
  const [showAccession, setShowAccession] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showPool, setShowPool] = useState(false);
  const samples = useQuery({
    queryKey: ["samples", study.id],
    queryFn: () => api<SampleRow[]>(`/studies/${study.id}/samples`),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Samples</h1>
          <p className="text-sm text-slate-500">
            {study.oid} — {study.name}
          </p>
        </div>
        <div className="flex gap-2">
          {permissions.includes("sample.aliquot") && (
            <Button variant="secondary" onClick={() => setShowPool(true)}>
              Pool
            </Button>
          )}
          {permissions.includes("sample.accession") && (
            <>
              <Button variant="secondary" onClick={() => setShowImport(true)}>
                Import CSV
              </Button>
              <Button variant="secondary" onClick={() => setShowBulk(true)}>
                Bulk accession
              </Button>
              <Button onClick={() => setShowAccession(true)}>+ Accession sample</Button>
            </>
          )}
        </div>
      </div>

      <Card>
        {samples.data?.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            No samples yet. Accession the first one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
                  <th className="px-3 py-2">Accession ID</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Subject</th>
                  <th className="px-3 py-2">Site</th>
                  <th className="px-3 py-2">Location</th>
                  <th className="px-3 py-2">Received</th>
                </tr>
              </thead>
              <tbody>
                {(samples.data ?? []).map((s) => (
                  <tr key={s.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2.5">
                      <Link
                        to="/samples/$sampleId"
                        params={{ sampleId: s.id }}
                        className="font-mono font-medium text-indigo-700 hover:underline"
                      >
                        {s.accessionId}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">{s.sampleType.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs">{s.subjectKey ?? "—"}</td>
                    <td className="px-3 py-2.5">{s.siteOid}</td>
                    <td className="px-3 py-2.5">
                      {s.storageUnit ? `${s.storageUnit} · ${s.storagePosition}` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-slate-500">{formatDateTime(s.receivedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showAccession && <AccessionModal onClose={() => setShowAccession(false)} />}
      {showBulk && <BulkAccessionModal onClose={() => setShowBulk(false)} />}
      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
      {showPool && <PoolModal onClose={() => setShowPool(false)} />}
    </div>
  );
}
