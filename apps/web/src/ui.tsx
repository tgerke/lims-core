import type { ReactNode } from "react";

export function Card(props: { title?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      {(props.title || props.actions) && (
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold tracking-wide text-slate-700 uppercase">
            {props.title}
          </h2>
          {props.actions}
        </header>
      )}
      <div className="p-5">{props.children}</div>
    </section>
  );
}

const STATUS_STYLES: Record<string, string> = {
  registered: "bg-slate-100 text-slate-700",
  in_storage: "bg-sky-100 text-sky-800",
  in_testing: "bg-amber-100 text-amber-800",
  in_transit: "bg-violet-100 text-violet-800",
  depleted: "bg-slate-200 text-slate-500",
  packed: "bg-slate-100 text-slate-700",
  received: "bg-emerald-100 text-emerald-800",
  assembled: "bg-slate-100 text-slate-700",
  shipped: "bg-violet-100 text-violet-800",
  delivered: "bg-emerald-100 text-emerald-800",
  on_hold: "bg-orange-100 text-orange-800",
  disposed: "bg-rose-100 text-rose-800",
  ordered: "bg-slate-100 text-slate-700",
  resulted: "bg-amber-100 text-amber-800",
  verified: "bg-sky-100 text-sky-800",
  signed: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-rose-100 text-rose-800",
  entered: "bg-amber-100 text-amber-800",
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? "bg-slate-100 text-slate-700";
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
}) {
  const variants = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-300",
    secondary:
      "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400",
    danger: "bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-300",
  };
  return (
    <button
      type={props.type ?? "button"}
      onClick={props.onClick}
      disabled={props.disabled}
      className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${variants[props.variant ?? "primary"]}`}
    >
      {props.children}
    </button>
  );
}

export function Field(props: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{props.label}</span>
      {props.children}
      {props.hint && <span className="mt-1 block text-xs text-slate-500">{props.hint}</span>}
    </div>
  );
}

export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:outline-none";

export function Modal(props: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">{props.title}</h3>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div className="p-5">{props.children}</div>
      </div>
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
      {message}
    </p>
  );
}

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}
