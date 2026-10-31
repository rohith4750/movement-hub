"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { ErrorText, PageHeader, Spinner, Stat } from "@/components/ui";
import { api, downloadFile } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth-store";
import { fullName, inr, label, today } from "@/lib/format";

interface Revenue { netRevenue: number; series: { period: string; method: string; total: number }[]; byServiceType: { type: string; total: number }[] }
interface Appts { total: number; noShowRate: number; cancellationRate: number; byStatus: { status: string; count: number }[]; completedByTherapist: { name?: string; count: number }[] }
interface Util { therapists: { therapistId: string; name: string; colorTag: string | null; booked: number; available: number; percent: number }[] }
interface Pkgs { sales: { name?: string; count: number; revenue: number; sessionsSold: number; sessionsUsed: number }[] }
interface Outstanding { totalDue: number; count: number; invoices: { id: string; invoiceNo: string; dueAmount: string; patient: { firstName: string; lastName: string | null; phone: string } }[] }

function Bars({ rows }: { rows: { label: string; value: number; display?: string; color?: string | null }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="mb-0.5 flex justify-between text-xs"><span>{r.label}</span><span className="font-semibold">{r.display ?? r.value}</span></div>
          <div className="h-2 rounded-full bg-navy-50"><div className="h-2 rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: r.color ?? "var(--color-navy-700)" }} /></div>
        </div>
      ))}
    </div>
  );
}

export default function ReportsPage() {
  const user = useAuth((s) => s.user);
  const isAdmin = hasRole(user, "ADMIN");
  const [from, setFrom] = useState(`${today().slice(0, 7)}-01`);
  const [to, setTo] = useState(today());
  const range = { from, to };
  const revenue = useQuery({ queryKey: ["r-revenue", range], queryFn: () => api.get<Revenue>("/reports/revenue", range) });
  const appts = useQuery({ queryKey: ["r-appts", range], queryFn: () => api.get<Appts>("/reports/appointments", range), enabled: isAdmin });
  const util = useQuery({ queryKey: ["r-util", range], queryFn: () => api.get<Util>("/reports/therapist-utilization", range), enabled: isAdmin });
  const pkgs = useQuery({ queryKey: ["r-pkgs", range], queryFn: () => api.get<Pkgs>("/reports/packages", range) });
  const due = useQuery({ queryKey: ["r-due"], queryFn: () => api.get<Outstanding>("/reports/outstanding") });

  const daily = Object.entries(
    (revenue.data?.series ?? []).reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.period.slice(0, 10)]: (acc[s.period.slice(0, 10)] ?? 0) + s.total }), {}),
  );

  return (
    <>
      <PageHeader
        title="Reports"
        actions={
          <>
            <input type="date" className="input w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" className="input w-40" value={to} onChange={(e) => setTo(e.target.value)} />
            {(["payments", "invoices", "appointments"] as const).map((t) => (
              <button key={t} className="btn-ghost" onClick={() => downloadFile(`/reports/export?type=${t}&from=${from}&to=${to}`, `${t}-${from}-${to}.csv`)}><Download size={14} /> {label(t)}</button>
            ))}
          </>
        }
      />
      <ErrorText error={revenue.error} />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Net revenue" value={revenue.data ? inr(revenue.data.netRevenue) : "…"} />
        <Stat label="Outstanding" value={due.data ? inr(due.data.totalDue) : "…"} hint={due.data ? `${due.data.count} invoices` : undefined} />
        {isAdmin && <Stat label="Appointments" value={appts.data?.total ?? "…"} hint={appts.data ? `No-show ${appts.data.noShowRate}% · Cancel ${appts.data.cancellationRate}%` : undefined} />}
        <Stat label="Packages sold" value={pkgs.data?.sales.reduce((s, x) => s + x.count, 0) ?? "…"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 font-bold">Daily collections</h2>
          {revenue.isLoading ? <Spinner /> : <Bars rows={daily.map(([d, v]) => ({ label: d, value: v, display: inr(v), color: "var(--color-gold-500)" }))} />}
        </div>
        <div className="card">
          <h2 className="mb-3 font-bold">Revenue by service</h2>
          <Bars rows={(revenue.data?.byServiceType ?? []).map((s) => ({ label: label(s.type), value: s.total, display: inr(s.total) }))} />
        </div>
        {isAdmin && (
          <div className="card">
            <h2 className="mb-3 font-bold">Therapist utilization</h2>
            <Bars rows={(util.data?.therapists ?? []).map((t) => ({ label: `${t.name} (${t.booked}/${t.booked + t.available})`, value: t.percent, display: `${t.percent}%`, color: t.colorTag }))} />
          </div>
        )}
        {isAdmin && (
          <div className="card">
            <h2 className="mb-3 font-bold">Appointments by status</h2>
            <Bars rows={(appts.data?.byStatus ?? []).map((s) => ({ label: label(s.status), value: s.count }))} />
          </div>
        )}
        <div className="card">
          <h2 className="mb-3 font-bold">Package sales</h2>
          <div className="table-wrap-sm"><table className="table">
            <thead><tr><th>Package</th><th>Sold</th><th>Revenue</th><th>Sessions used</th></tr></thead>
            <tbody>{pkgs.data?.sales.map((s) => <tr key={s.name}><td>{s.name}</td><td>{s.count}</td><td>{inr(s.revenue)}</td><td>{s.sessionsUsed}/{s.sessionsSold}</td></tr>)}</tbody>
          </table></div>
        </div>
        <div className="card">
          <h2 className="mb-3 font-bold">Outstanding invoices</h2>
          <div className="table-wrap-sm"><table className="table">
            <thead><tr><th>Invoice</th><th>Patient</th><th>Phone</th><th className="text-right">Due</th></tr></thead>
            <tbody>{due.data?.invoices.map((i) => <tr key={i.id}><td className="font-mono text-xs">{i.invoiceNo}</td><td>{fullName(i.patient)}</td><td>{i.patient.phone}</td><td className="text-right font-bold">{inr(i.dueAmount)}</td></tr>)}</tbody>
          </table></div>
        </div>
      </div>
    </>
  );
}
