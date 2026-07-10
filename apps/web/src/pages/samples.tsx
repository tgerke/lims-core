import { SAMPLE_TYPES } from "@lims-core/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { api, type SampleRow, type Site } from "../api.js";
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

export function SamplesPage() {
  const { study, permissions } = useStudy();
  const [showAccession, setShowAccession] = useState(false);
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
        {permissions.includes("sample.accession") && (
          <Button onClick={() => setShowAccession(true)}>+ Accession sample</Button>
        )}
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
    </div>
  );
}
