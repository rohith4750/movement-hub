"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ErrorText, Field, Modal, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import { label } from "@/lib/format";

type Settings = Record<string, string | number> & { branch: { name: string; gstin: string | null } };

const FIELDS: { key: string; type: "number" | "time" | "text" }[] = [
  { key: "consultationFee", type: "number" },
  { key: "therapySessionFee", type: "number" },
  { key: "homeVisitFee", type: "number" },
  { key: "travelChargePerKm", type: "number" },
  { key: "gstPercent", type: "number" },
  { key: "defaultSlotMinutes", type: "number" },
  { key: "openingTime", type: "time" },
  { key: "closingTime", type: "time" },
  { key: "cancellationHours", type: "number" },
  { key: "reminderHoursBefore", type: "number" },
  { key: "invoicePrefix", type: "text" },
];

export default function SettingsPage() {
  const qc = useQueryClient();
  const role = useAuth((s) => s.user?.role);
  const q = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/settings") });
  const [f, setF] = useState<Record<string, string>>({});
  useEffect(() => {
    if (q.data) setF(Object.fromEntries(FIELDS.map(({ key }) => [key, String(q.data[key] ?? "")])));
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => api.patch("/settings", Object.fromEntries(FIELDS.map(({ key, type }) => [key, type === "number" ? Number(f[key]) : f[key]]))),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  if (q.isLoading) return <Spinner />;
  return (
    <>
      <PageHeader title="Hospital settings" subtitle={q.data?.branch.name} />
      <div className="card grid gap-4 md:grid-cols-3">
        {FIELDS.map(({ key, type }) => (
          <Field key={key} label={label(key.replace(/([A-Z])/g, "_$1"))}>
            <input className="input" type={type} value={f[key] ?? ""} onChange={(e) => setF({ ...f, [key]: e.target.value })} />
          </Field>
        ))}
        <div className="md:col-span-3"><ErrorText error={save.error ?? q.error} /></div>
        <div className="md:col-span-3 flex justify-end"><button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isSuccess ? "Saved ✓" : "Save settings"}</button></div>
      </div>
      {role === "SUPER_ADMIN" ? <DangerZone /> : null}
    </>
  );
}

interface ResetPreview {
  enabled: boolean;
  phrase: string;
  adminsKept: number;
  usersRemoved: number;
  totalRows: number;
  tables: { table: string; rows: number }[];
}

/** Super Admin only: wipe test data before going live. Keeps admin accounts, the branch + settings and catalogues. */
function DangerZone() {
  const router = useRouter();
  const clear = useAuth((s) => s.clear);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [typed, setTyped] = useState("");
  const preview = useQuery({ queryKey: ["data-reset"], queryFn: () => api.get<ResetPreview>("/settings/data-reset"), enabled: open });
  const flush = useMutation({
    mutationFn: () => api.post<{ rowsDeleted: number; usersRemoved: number; adminsKept: number }>("/settings/data-reset", { confirm: typed, password }),
    onSuccess: (r) => {
      alert(`Done. ${r.rowsDeleted} records and ${r.usersRemoved} non-admin accounts were deleted. ${r.adminsKept} admin account(s) kept. Please sign in again.`);
      clear();
      router.replace("/login");
    },
  });
  const p = preview.data;
  const ready = !!p && p.enabled && password.length > 0 && typed === p.phrase;
  const close = () => {
    setOpen(false);
    setPassword("");
    setTyped("");
    flush.reset();
  };

  return (
    <>
      <div className="card mt-6 border-red-300">
        <h2 className="font-semibold text-red-700">Danger zone</h2>
        <p className="mt-1 text-sm text-navy-500">Delete all patients, staff profiles, appointments, plans, bills and payments, but keep the admin accounts, branch settings and service catalogues. Use this once, before going live.</p>
        <div className="mt-3"><button className="btn-ghost border border-red-300 text-red-700" onClick={() => setOpen(true)}>Review &amp; flush data…</button></div>
      </div>

      <Modal open={open} onClose={close} title="Flush all data except admin accounts">
        {preview.isLoading ? <Spinner /> : p ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
              This permanently deletes <b>{p.totalRows}</b> records and <b>{p.usersRemoved}</b> non-admin account(s). It cannot be undone. Back up first (for example a Neon branch or snapshot).
            </div>
            {p.tables.length ? (
              <div>
                <div className="label">Will be deleted</div>
                <ul className="mt-1 grid grid-cols-2 gap-x-4 text-sm">{p.tables.map((t) => <li key={t.table} className="flex justify-between"><span>{label(t.table.replace(/([A-Z])/g, "_$1").replace(/^_/, ""))}</span><b>{t.rows}</b></li>)}</ul>
              </div>
            ) : <p className="text-sm text-navy-500">There is no activity data to delete.</p>}
            <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Kept: <b>{p.adminsKept}</b> admin account(s), the branch and its settings, specialisations and the package catalogue.</div>
            {!p.enabled && (
              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                Flushing is switched off on this server. Set <code>ALLOW_DATA_RESET=true</code> in the server environment variables and redeploy, run this, then remove the variable.
              </div>
            )}
            <Field label="Your password"><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Field label={`Type ${p.phrase} to confirm`}><input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} /></Field>
            <ErrorText error={flush.error} />
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={close}>Cancel</button>
              <button className="btn-primary bg-red-700 hover:bg-red-800" disabled={!ready || flush.isPending} onClick={() => flush.mutate()}>{flush.isPending ? "Deleting…" : "Delete all data"}</button>
            </div>
          </div>
        ) : <ErrorText error={preview.error} />}
      </Modal>
    </>
  );
}

