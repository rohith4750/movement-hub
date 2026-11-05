"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Tv, Volume2 } from "lucide-react";
import { ErrorText, Field, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import { label } from "@/lib/format";
import { playClinicChime } from "@/lib/tv-chime";

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
  { key: "tvStaffKey", type: "text" },
  { key: "tvQrUrl", type: "text" },
  { key: "tvQrLabel", type: "text" },
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

      {/* ── TV DISPLAY / SMART TV READ-ONLY BOARDS ── */}
      <div className="card mb-6 space-y-4">
        <div className="flex items-center justify-between border-b border-navy-100 pb-3">
          <div>
            <h2 className="text-lg font-bold text-navy-900 flex items-center gap-2">
              <Tv className="text-gold-600" size={20} />
              Clinic TV &amp; Wall Displays
            </h2>
            <p className="text-xs text-navy-500">
              Opens on any Smart TV browser (Samsung Tizen, LG webOS), Fire TV stick, Chromecast, or mini PC. No installation required.
            </p>
          </div>
          <button
            type="button"
            onClick={playClinicChime}
            className="btn-ghost flex items-center gap-1.5 text-xs text-gold-700 hover:text-gold-800"
          >
            <Volume2 size={16} /> Test Waiting Chime
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Waiting Room TV */}
          <div className="rounded-xl border border-navy-200/80 bg-navy-50/50 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-navy-900">1. Patient Waiting-Room Board</span>
              <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                PUBLIC / READ-ONLY
              </span>
            </div>
            <p className="text-xs text-navy-600 mb-4">
              Patient privacy-masked (first name + initial). Shows current sessions, next up queue, rotating clinic timings, health tips, and call-out chime.
            </p>
            <div className="flex items-center gap-2">
              <Link href="/tv" target="_blank" className="btn-primary text-xs py-1.5 flex items-center gap-1.5">
                <Tv size={14} /> Open TV Board
              </Link>
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== "undefined") {
                    navigator.clipboard.writeText(`${window.location.origin}/tv`);
                    alert(`Copied: ${window.location.origin}/tv`);
                  }
                }}
                className="btn-ghost text-xs py-1.5"
              >
                Copy Link
              </button>
            </div>
          </div>

          {/* Staff Wall TV */}
          <div className="rounded-xl border border-navy-200/80 bg-navy-50/50 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-navy-900">2. Back-Office Staff Wall</span>
              <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                INTERNAL / KEY PROTECTED
              </span>
            </div>
            <p className="text-xs text-navy-600 mb-4">
              Operational schedule for the staff room. Shows per-physio load, walk-in counts, and full timeline with patient codes.
            </p>
            <div className="flex items-center gap-2">
              <Link href={`/tv/staff?key=${f.tvStaffKey || ""}`} target="_blank" className="btn-primary text-xs py-1.5 flex items-center gap-1.5">
                <Tv size={14} /> Open Staff Wall
              </Link>
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== "undefined") {
                    const url = `${window.location.origin}/tv/staff?key=${f.tvStaffKey || ""}`;
                    navigator.clipboard.writeText(url);
                    alert(`Copied: ${url}`);
                  }
                }}
                className="btn-ghost text-xs py-1.5"
              >
                Copy Link
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── GENERAL SETTINGS ── */}
      <div className="card grid gap-4 md:grid-cols-3">
        {FIELDS.map(({ key, type }) => (
          <Field key={key} label={label(key.replace(/([A-Z])/g, "_$1"))}>
            <input className="input" type={type} value={f[key] ?? ""} onChange={(e) => setF({ ...f, [key]: e.target.value })} />
          </Field>
        ))}
        <div className="md:col-span-3"><ErrorText error={save.error ?? q.error} /></div>
        <div className="md:col-span-3 flex justify-end">
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isSuccess ? "Saved ✓" : "Save settings"}
          </button>
        </div>
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

  return (
    <div className="card mt-6 border-rose-200 bg-rose-50/40">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-rose-900">Reset hospital data</h3>
          <p className="text-xs text-rose-700">Wipe test patients, appointments, billing and audit logs. Only admin accounts and clinic catalog remain.</p>
        </div>
        <button className="btn-danger" onClick={() => setOpen(true)}>Reset data…</button>
      </div>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="card max-w-md space-y-4">
            <h4 className="font-bold text-navy-900">Confirm Reset</h4>
            <p className="text-xs text-navy-600">This action cannot be undone. Enter your password and confirmation phrase to proceed.</p>
            <input className="input" type="password" placeholder="Admin password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <input className="input" placeholder={`Type "${preview.data?.phrase ?? ""}"`} value={typed} onChange={(e) => setTyped(e.target.value)} />
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn-danger" disabled={flush.isPending || typed !== preview.data?.phrase} onClick={() => flush.mutate()}>
                {flush.isPending ? "Resetting…" : "Confirm Reset"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
