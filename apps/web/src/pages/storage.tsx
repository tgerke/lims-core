import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { api, type BoxMap, type StorageUnit } from "../api.js";
import { useStudy } from "../app.js";
import { Card } from "../ui.js";

function pathTo(unit: StorageUnit, byId: Map<string, StorageUnit>): string {
  const parts = [unit.name];
  let current = unit;
  while (current.parentId && byId.has(current.parentId)) {
    current = byId.get(current.parentId) as StorageUnit;
    parts.unshift(current.name);
  }
  return parts.join(" / ");
}

function BoxGrid({ map }: { map: BoxMap }) {
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
                  return (
                    <Link
                      key={position}
                      to="/samples/$sampleId"
                      params={{ sampleId: occupant.sampleId }}
                      title={`${occupant.accessionId} · ${occupant.sampleType.replace(/_/g, " ")}`}
                      className="flex h-10 items-center justify-center rounded bg-indigo-500 text-[10px] font-medium text-white hover:bg-indigo-600"
                    >
                      {position}
                    </Link>
                  );
                }
                const occupiedByOther = others.has(position);
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
  const { study } = useStudy();
  const units = useQuery({
    queryKey: ["storage-units", study.id],
    queryFn: () => api<StorageUnit[]>(`/studies/${study.id}/storage-units`),
  });
  const [boxId, setBoxId] = useState<string | null>(null);

  const byId = useMemo(() => new Map((units.data ?? []).map((u) => [u.id, u])), [units.data]);
  const boxes = (units.data ?? []).filter((u) => u.kind === "box");
  const selectedId = boxId ?? boxes[0]?.id ?? null;

  const map = useQuery({
    queryKey: ["box-map", study.id, selectedId],
    queryFn: () => api<BoxMap>(`/studies/${study.id}/storage-units/${selectedId}/map`),
    enabled: selectedId !== null,
  });

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
          {map.data ? (
            <BoxGrid map={map.data} />
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
