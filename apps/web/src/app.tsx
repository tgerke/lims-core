import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { createContext, useContext, useEffect, useState } from "react";
import { ApiError, api, type Me, type Study } from "./api.js";

interface StudyContextValue {
  me: Me;
  study: Study;
  studies: Study[];
  permissions: string[];
  setStudyId: (id: string) => void;
}

const StudyContext = createContext<StudyContextValue | null>(null);

export function useStudy(): StudyContextValue {
  const value = useContext(StudyContext);
  if (!value) throw new Error("useStudy outside AppLayout");
  return value;
}

export function AppLayout() {
  const navigate = useNavigate();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/auth/me"), retry: false });
  const studies = useQuery({
    queryKey: ["studies"],
    queryFn: () => api<Study[]>("/studies"),
    enabled: me.isSuccess,
  });
  const [studyId, setStudyId] = useState<string | null>(localStorage.getItem("lims.studyId"));

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) {
      navigate({ to: "/login" });
    }
  }, [me.error, navigate]);

  const study = studies.data?.find((s) => s.id === studyId) ?? studies.data?.[0] ?? null;

  const permissions = useQuery({
    queryKey: ["permissions", study?.id],
    queryFn: () => api<{ permissions: string[] }>(`/studies/${study?.id}/permissions`),
    enabled: study !== null,
  });

  if (me.isLoading || studies.isLoading) {
    return <div className="p-10 text-center text-slate-500">Loading…</div>;
  }
  if (!me.data) return null;
  if (!study) {
    return (
      <div className="p-10 text-center text-slate-500">
        No studies visible to your account. Ask an administrator for a role grant.
      </div>
    );
  }

  const select = (id: string) => {
    localStorage.setItem("lims.studyId", id);
    setStudyId(id);
  };

  const logout = async () => {
    await api("/auth/logout", { method: "POST", body: "{}" });
    navigate({ to: "/login" });
  };

  return (
    <StudyContext.Provider
      value={{
        me: me.data,
        study,
        studies: studies.data ?? [],
        permissions: permissions.data?.permissions ?? [],
        setStudyId: select,
      }}
    >
      <div className="min-h-screen">
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
            <Link to="/samples" className="text-lg font-bold tracking-tight text-indigo-700">
              lims-core
            </Link>
            <nav className="flex gap-1 text-sm">
              <Link
                to="/samples"
                className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100 [&.active]:bg-indigo-50 [&.active]:font-medium [&.active]:text-indigo-700"
              >
                Samples
              </Link>
              <Link
                to="/shipments"
                className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100 [&.active]:bg-indigo-50 [&.active]:font-medium [&.active]:text-indigo-700"
              >
                Shipments
              </Link>
              <Link
                to="/kits"
                className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100 [&.active]:bg-indigo-50 [&.active]:font-medium [&.active]:text-indigo-700"
              >
                Kits
              </Link>
              <Link
                to="/storage"
                className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100 [&.active]:bg-indigo-50 [&.active]:font-medium [&.active]:text-indigo-700"
              >
                Storage
              </Link>
              <Link
                to="/inventory"
                className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100 [&.active]:bg-indigo-50 [&.active]:font-medium [&.active]:text-indigo-700"
              >
                Inventory
              </Link>
              <Link
                to="/reports"
                className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100 [&.active]:bg-indigo-50 [&.active]:font-medium [&.active]:text-indigo-700"
              >
                Reports
              </Link>
              <Link
                to="/audit"
                className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100 [&.active]:bg-indigo-50 [&.active]:font-medium [&.active]:text-indigo-700"
              >
                Audit trail
              </Link>
            </nav>
            <div className="ml-auto flex items-center gap-4">
              <select
                value={study.id}
                onChange={(e) => select(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
              >
                {(studies.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.oid} — {s.name}
                  </option>
                ))}
              </select>
              <span className="text-sm text-slate-600">{me.data.fullName}</span>
              <button
                type="button"
                onClick={logout}
                className="text-sm text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">
          <Outlet />
        </main>
      </div>
    </StudyContext.Provider>
  );
}
