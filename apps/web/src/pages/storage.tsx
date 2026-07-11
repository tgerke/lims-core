import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { api, type BoxMap, type SampleRow, type StorageUnit } from "../api.js";
import { useStudy } from "../app.js";
import { Button, Card, ErrorNote } from "../ui.js";

function pathTo(unit: StorageUnit, byId: Map<string, StorageUnit>): string {
  const parts = [unit.name];
  let current = unit;
  while (current.parentId && byId.has(current.parentId)) {
    current = byId.get(current.parentId) as StorageUnit;
    parts.unshift(current.name);
  }
  return parts.join(" / ");
}

interface PickedUp {
  id: string;
  accessionId: string;
  from: string | null;
}

function BoxGrid({
  map,
  canArrange,
  pickedUp,
  onPickUp,
  onPlace,
}: {
  map: BoxMap;
  canArrange: boolean;
  pickedUp: PickedUp | null;
  onPickUp: (sampleId: string, accessionId: string, position: string) => void;
  onPlace: (position: string) => void;
}) {
  const { unit, occupants, othersOccupiedPositions } = map;
  const mine = new Map(occupants.map((o) => [o.position, o]));
  const others = new Set(othersOccupiedPositions);
  const total = unit.gridRows * unit.gridCols;
  const used = occupants.length + othersOccupiedPositions.length;

  const cols = Array.from({ length: unit.gridCols }, (_, c) => c + 1);
  const rows = Array.from({ length: unit.gridRows }, (_, r) => String.fromCharCode(65 + r));

  return (
    <Card
      title={unit.name}
      actions={
        <span className="text-sm text-slate-500">
          {used} / {total} filled
          {unit.temperatureC ? ` · ${unit.temperatureC}°C` : ""}
        </span>
      }
    >
      <div className="overflow-x-auto">
        <div
          className="inline-grid gap-1"
          style={{ gridTemplateColumns: `1.5rem repeat(${unit.gridCols}, 2.5rem)` }}
        >
          <span />
          {cols.map((n) => (
            <span key={`col-${n}`} className="text-center text-xs text-slate-400">
              {n}
            </span>
          ))}
          {rows.map((letter) => (
            <Fragment key={`row-${letter}`}>
              <span className="flex items-center text-xs text-slate-400">{letter}</span>
              {cols.map((n) => {
                const position = `${letter}${n}`;
                const occupant = mine.get(position);
                if (occupant) {
                  const isPicked = pickedUp?.id === occupant.sampleId;
                  const title = `${occupant.accessionId} · ${occupant.sampleType.replace(/_/g, " ")}`;
                  const cls = `flex h-10 items-center justify-center rounded text-[10px] font-medium text-white ${
                    isPicked ? "bg-amber-500 ring-2 ring-amber-300" : "bg-indigo-500"
                  }`;
                  if (canArrange) {
                    return (
                      <button
                        key={position}
                        type="button"
                        title={title}
                        onClick={() => onPickUp(occupant.sampleId, occupant.accessionId, position)}
                        className={`${cls} hover:bg-indigo-600`}
                      >
                        {position}
                      </button>
                    );
                  }
                  return (
                    <Link
                      key={position}
                      to="/samples/$sampleId"
                      params={{ sampleId: occupant.sampleId }}
                      title={title}
                      className={`${cls} hover:bg-indigo-600`}
                    >
                      {position}
                    </Link>
                  );
                }
                const occupiedByOther = others.has(position);
                if (!occupiedByOther && canArrange && pickedUp) {
                  return (
                    <button
                      key={position}
                      type="button"
                      title={`Place ${pickedUp.accessionId} here`}
                      onClick={() => onPlace(position)}
                      className="flex h-10 items-center justify-center rounded border border-dashed border-emerald-300 bg-emerald-50 text-[10px] text-emerald-600 hover:bg-emerald-100"
                    >
                      {position}
                    </button>
                  );
                }
                return (
                  <span
                    key={position}
                    title={occupiedByOther ? "occupied by another study" : "free"}
                    className={`flex h-10 items-center justify-center rounded text-[10px] ${
                      occupiedByOther
                        ? "bg-slate-300 text-slate-500"
                        : "border border-dashed border-slate-200 text-slate-300"
                    }`}
                  >
                    {position}
                  </span>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
      <div className="mt-4 flex gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-indigo-500" /> this study
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-slate-300" /> another study
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded border border-dashed border-slate-300" />{" "}
          free
        </span>
      </div>
    </Card>
  );
}

export function StoragePage() {
  const { study, permissions } = useStudy();
  const queryClient = useQueryClient();
  const canArrange = permissions.includes("sample.store");
  const [boxId, setBoxId] = useState<string | null>(null);
  const [pickedUp, setPickedUp] = useState<PickedUp | null>(null);

  const units = useQuery({
    queryKey: ["storage-units", study.id],
    queryFn: () => api<StorageUnit[]>(`/studies/${study.id}/storage-units`),
  });
  const samples = useQuery({
    queryKey: ["samples", study.id],
    queryFn: () => api<SampleRow[]>(`/studies/${study.id}/samples`),
    enabled: canArrange,
  });

  const byId = useMemo(() => new Map((units.data ?? []).map((u) => [u.id, u])), [units.data]);
  const boxes = (units.data ?? []).filter((u) => u.kind === "box");
  const selectedId = boxId ?? boxes[0]?.id ?? null;

  const map = useQuery({
    queryKey: ["box-map", study.id, selectedId],
    queryFn: () => api<BoxMap>(`/studies/${study.id}/storage-units/${selectedId}/map`),
    enabled: selectedId !== null,
  });

  const move = useMutation({
    mutationFn: (position: string) =>
      api(`/samples/${pickedUp?.id}/move`, {
        method: "POST",
        body: JSON.stringify({ storageUnitId: selectedId, position }),
      }),
    onSuccess: () => {
      setPickedUp(null);
      queryClient.invalidateQueries({ queryKey: ["box-map", study.id, selectedId] });
      queryClient.invalidateQueries({ queryKey: ["samples", study.id] });
    },
  });

  const unstored = (samples.data ?? []).filter(
    (s) => !s.storageUnit && (s.status === "registered" || s.status === "in_testing"),
  );

  const pickUpOccupant = (sampleId: string, accessionId: string, position: string) => {
    move.reset();
    setPickedUp((prev) =>
      prev?.id === sampleId ? null : { id: sampleId, accessionId, from: position },
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Storage</h1>
        <p className="text-sm text-slate-500">
          {study.oid} — {study.name}
        </p>
      </div>

      {boxes.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-sm text-slate-500">No boxes configured.</p>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <div className="space-y-6">
            <Card title="Boxes">
              <ul className="space-y-1">
                {boxes.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => setBoxId(b.id)}
                      className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                        b.id === selectedId
                          ? "bg-indigo-50 font-medium text-indigo-700"
                          : "text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      {pathTo(b, byId)}
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
            {canArrange && (
              <Card title="Arrange">
                {pickedUp ? (
                  <div className="space-y-2 text-sm">
                    <p className="text-slate-700">
                      Moving{" "}
                      <Link
                        to="/samples/$sampleId"
                        params={{ sampleId: pickedUp.id }}
                        className="font-mono font-medium text-indigo-700 hover:underline"
                      >
                        {pickedUp.accessionId}
                      </Link>
                      . Click a free (green) cell to place it.
                    </p>
                    <Button variant="secondary" onClick={() => setPickedUp(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-slate-500">
                      Pick up an unstored sample to place, or click a filled cell to move it.
                    </p>
                    <select
                      className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
                      value=""
                      onChange={(e) => {
                        const s = unstored.find((u) => u.id === e.target.value);
                        if (s) setPickedUp({ id: s.id, accessionId: s.accessionId, from: null });
                      }}
                    >
                      <option value="">Place unstored sample…</option>
                      {unstored.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.accessionId} — {s.sampleType.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <ErrorNote message={move.error ? move.error.message : null} />
              </Card>
            )}
          </div>
          {map.data ? (
            <BoxGrid
              map={map.data}
              canArrange={canArrange}
              pickedUp={pickedUp}
              onPickUp={pickUpOccupant}
              onPlace={(position) => move.mutate(position)}
            />
          ) : (
            <Card>
              <p className="py-8 text-center text-sm text-slate-500">
                {map.isLoading ? "Loading…" : "Select a box."}
              </p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
