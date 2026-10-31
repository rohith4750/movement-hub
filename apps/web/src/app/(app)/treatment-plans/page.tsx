"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { PlanForm } from "@/components/plan-form";
import { hasRole, useAuth } from "@/lib/auth-store";
import { Empty, ErrorText, Modal, PageHeader, Pager, Spinner, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { date, fullName, label } from "@/lib/format";
import type { TreatmentPlan } from "@/lib/types";

export default function TreatmentPlansPage() {
  const [status, setStatus] = useState("ACTIVE");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const canManage = hasRole(user, "PHYSIOTHERAPIST", "ADMIN");
  const q = useQuery({ queryKey: ["plans", status, search, page], queryFn: () => api.page<TreatmentPlan>("/treatment-plans", { status: status || undefined, search, page }) });

  return (
    <>
      <PageHeader
        title="Treatment plans"
        subtitle="Create here, from a consultation, or from the booking page."
        actions={canManage && <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New plan</button>}
      />
      <Modal open={creating} onClose={() => setCreating(false)} title="New treatment plan" wide>
        {creating && <PlanForm onSaved={(planId) => { setCreating(false); router.push(`/treatment-plans/${planId}`); }} onCancel={() => setCreating(false)} />}
      </Modal>
      <div className="card">
        <div className="mb-4 flex flex-wrap gap-3">
          <input className="input max-w-xs" placeholder="Search title or plan no." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          <select className="input max-w-44" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            {["", "DRAFT", "ACTIVE", "COMPLETED", "CANCELLED"].map((s) => <option key={s} value={s}>{s ? label(s) : "All"}</option>)}
          </select>
        </div>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorText error={q.error} /> : !q.data?.data.length ? <Empty>No plans.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Plan</th><th>Patient</th><th>Physiotherapist</th><th>Sessions</th><th>Frequency</th><th>Status</th><th>Created</th></tr></thead>
              <tbody>
                {q.data.data.map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/treatment-plans/${p.id}`} className="font-semibold hover:underline">{p.title}</Link><div className="font-mono text-xs text-navy-500">{p.planNo}</div></td>
                    <td>{fullName(p.patient)}</td>
                    <td>{p.therapist.user.name}</td>
                    <td>{p.prescribedSessions}</td>
                    <td>{p.frequencyPerWeek}× / week</td>
                    <td><StatusBadge status={p.status} /></td>
                    <td>{date(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {q.data && <Pager page={page} totalPages={q.data.meta.totalPages} onChange={setPage} />}
      </div>
    </>
  );
}
