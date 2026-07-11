import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { api, type InventoryItem, type InventoryLot } from "../api.js";
import { useStudy } from "../app.js";
import { Button, Card, ErrorNote, Field, inputClass, Modal, StatusBadge } from "../ui.js";

const CATEGORIES = ["reagent", "consumable", "control", "standard"] as const;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function NewItemModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [catalogNumber, setCatalogNumber] = useState("");
  const [vendor, setVendor] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("reagent");
  const [unit, setUnit] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api("/inventory/items", {
        method: "POST",
        body: JSON.stringify({
          name,
          category,
          unit,
          ...(catalogNumber ? { catalogNumber } : {}),
          ...(vendor ? { vendor } : {}),
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
      onClose();
    },
  });

  return (
    <Modal title="Catalog a reagent" onClose={onClose}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (name.trim() && unit.trim()) create.mutate();
        }}
        className="space-y-4"
      >
        <Field label="Name">
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Taq polymerase"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select
              className={inputClass}
              value={category}
              onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Unit of measure">
            <input
              className={inputClass}
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="uL"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Catalog number">
            <input
              className={inputClass}
              value={catalogNumber}
              onChange={(e) => setCatalogNumber(e.target.value)}
            />
          </Field>
          <Field label="Vendor">
            <input
              className={inputClass}
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
            />
          </Field>
        </div>
        <ErrorNote message={create.error ? create.error.message : null} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim() || !unit.trim() || create.isPending}>
            Save item
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ReceiveLotModal({ items, onClose }: { items: InventoryItem[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [itemId, setItemId] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [quantity, setQuantity] = useState("");
  const [expiryDate, setExpiryDate] = useState("");

  const receive = useMutation({
    mutationFn: () =>
      api("/inventory/lots", {
        method: "POST",
        body: JSON.stringify({
          itemId,
          lotNumber,
          quantity: Number(quantity),
          ...(expiryDate ? { expiryDate } : {}),
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-lots"] });
      onClose();
    },
  });

  const valid = itemId && lotNumber.trim() && Number(quantity) > 0;

  return (
    <Modal title="Receive a lot" onClose={onClose}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (valid) receive.mutate();
        }}
        className="space-y-4"
      >
        <Field label="Reagent">
          <select className={inputClass} value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">Choose a reagent…</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name} ({it.unit})
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Lot number">
            <input
              className={inputClass}
              value={lotNumber}
              onChange={(e) => setLotNumber(e.target.value)}
            />
          </Field>
          <Field label="Quantity">
            <input
              className={inputClass}
              type="number"
              min="0"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>
          <Field label="Expiry">
            <input
              className={inputClass}
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
            />
          </Field>
        </div>
        <ErrorNote message={receive.error ? receive.error.message : null} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid || receive.isPending}>
            Receive lot
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ConsumeModal({ lot, onClose }: { lot: InventoryLot; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");

  const consume = useMutation({
    mutationFn: () =>
      api(`/inventory/lots/${lot.id}/consume`, {
        method: "POST",
        body: JSON.stringify({ quantity: Number(quantity), ...(note ? { note } : {}) }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-lots"] });
      onClose();
    },
  });

  const valid = Number(quantity) > 0;

  return (
    <Modal title={`Consume from ${lot.lotNumber}`} onClose={onClose}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (valid) consume.mutate();
        }}
        className="space-y-4"
      >
        <p className="text-sm text-slate-500">
          {lot.itemName} — {Number(lot.quantityRemaining)} {lot.itemUnit} remaining.
        </p>
        <Field label={`Quantity (${lot.itemUnit})`}>
          <input
            className={inputClass}
            type="number"
            min="0"
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
        <Field label="Note">
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ErrorNote message={consume.error ? consume.error.message : null} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid || consume.isPending}>
            Record consumption
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function LotActions({ lot, canManage }: { lot: InventoryLot; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [consuming, setConsuming] = useState(false);
  const discard = useMutation({
    mutationFn: () => api(`/inventory/lots/${lot.id}/discard`, { method: "POST", body: "{}" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["inventory-lots"] }),
  });

  if (!canManage) return null;
  const closed = lot.status === "depleted" || lot.status === "discarded";
  if (closed) return null;

  return (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" onClick={() => setConsuming(true)}>
        Consume
      </Button>
      <Button variant="danger" onClick={() => discard.mutate()} disabled={discard.isPending}>
        Discard
      </Button>
      {consuming && <ConsumeModal lot={lot} onClose={() => setConsuming(false)} />}
    </div>
  );
}

export function InventoryPage() {
  const { permissions } = useStudy();
  const canManage = permissions.includes("inventory.manage");
  const [showItem, setShowItem] = useState(false);
  const [showReceive, setShowReceive] = useState(false);

  const items = useQuery({
    queryKey: ["inventory-items"],
    queryFn: () => api<InventoryItem[]>("/inventory/items"),
  });
  const lots = useQuery({
    queryKey: ["inventory-lots"],
    queryFn: () => api<InventoryLot[]>("/inventory/lots"),
  });

  const today = todayIso();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Reagent inventory</h1>
          <p className="text-sm text-slate-500">Lab-wide reagents, lots, and expiry.</p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setShowItem(true)}>
              + Catalog reagent
            </Button>
            <Button onClick={() => setShowReceive(true)} disabled={(items.data ?? []).length === 0}>
              + Receive lot
            </Button>
          </div>
        )}
      </div>

      <Card>
        {lots.data?.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No lots received yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
                  <th className="px-3 py-2">Reagent</th>
                  <th className="px-3 py-2">Lot</th>
                  <th className="px-3 py-2">Expiry</th>
                  <th className="px-3 py-2">On hand</th>
                  <th className="px-3 py-2">Status</th>
                  {canManage && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {(lots.data ?? []).map((lot) => {
                  const expired = lot.expiryDate !== null && lot.expiryDate < today;
                  return (
                    <tr key={lot.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2.5 font-medium text-slate-800">
                        {lot.itemName}
                        <span className="ml-2 text-xs text-slate-400">{lot.category}</span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-slate-600">{lot.lotNumber}</td>
                      <td
                        className={`px-3 py-2.5 ${expired ? "font-medium text-rose-600" : "text-slate-500"}`}
                      >
                        {lot.expiryDate ?? "—"}
                        {expired && " (expired)"}
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">
                        {Number(lot.quantityRemaining)} / {Number(lot.quantityReceived)}{" "}
                        {lot.itemUnit}
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge status={lot.status} />
                      </td>
                      {canManage && (
                        <td className="px-3 py-2.5">
                          <LotActions lot={lot} canManage={canManage} />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showItem && <NewItemModal onClose={() => setShowItem(false)} />}
      {showReceive && (
        <ReceiveLotModal items={items.data ?? []} onClose={() => setShowReceive(false)} />
      )}
    </div>
  );
}
