"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { PlanForm } from "@/components/plan-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ConfirmDelete, ErrorText, Field, Modal, PageHeader, Spinner, Stat, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth-store";
import { date, fullName } from "@/lib/format";
import type { TreatmentPlan } from "@/lib/types";

type PlanDetail = TreatmentPlan & {
  progress: { completedSessions: number; upcomingSessions: number; remaining: number; percent: number };
  consultation: { chiefComplaint: string; clinicalImpression: string | null; assessment: { painScore: number; painLocation: string | null } | null } | null;
  therapySessions: { id: string; sessionNumber: number | null; status: string; painBefore: number | null; painAfter: number | null; completedAt: string | null }[];
};

export default function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const q = useQuery({ queryKey: ["plan", id], queryFn: () => api.get<PlanDetail>(`/treatment-plans/${id}`) });
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["plan", id] });
    qc.invalidateQueries({ queryKey: ["plans"] });
  };
  const act = useMutation({
    mutationFn: (action: "activate" | "complete") => api.post(`/treatment-plans/${id}/${action}`),
    onSuccess: refresh,
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/treatment-plans/${id}/cancel`, { reason: reason.trim() }),
    onSuccess: () => {
      refresh();
      setCancelling(false);
      setReason("");
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/treatment-plans/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plans"] });
      router.push("/treatment-plans");
    },
  });

  if (q.isLoading) return <Spinner />;
  if (!q.data) return <ErrorText error={q.error} />;
  const p = q.data;
  // Any physiotherapist (and the Super Admin) manages plans — the physio team shares the work.
  const canManage = hasRole(user, "PHYSIOTHERAPIST", "ADMIN");
  const open = ["DRAFT", "ACTIVE"].includes(p.status);
  const nothingDone = p.progress.completedSessions === 0 && p.progress.upcomingSessions === 0;

  return (
    <>
      <PageHeader
        title={p.title}
        subtitle={`${p.planNo} · ${fullName(p.patient)} · ${p.therapist.user.name}`}
        actions={
          <>
            <StatusBadge status={p.status} />
            {canManage && open && <button className="btn-ghost" onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>}
            {canManage && p.status === "DRAFT" && <button className="btn-primary" disabled={act.isPending} onClick={() => act.mutate("activate")}>Activate</button>}
            {canManage && p.status === "ACTIVE" && <button className="btn-gold" disabled={act.isPending} onClick={() => act.mutate("complete")}>Mark complete</button>}
            {canManage && open && <button className="btn-ghost text-rose-600" onClick={() => { cancel.reset(); setCancelling(true); }}>Cancel plan</button>}
            {canManage && <button className="btn-ghost text-rose-600" title={nothingDone ? "Delete plan" : "Plans with sessions can't be deleted — cancel instead"} onClick={() => { remove.reset(); setDeleting(true); }}><Trash2 size={14} /> Delete</button>}
          </>
        }
      />
      <ErrorText error={act.error} />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Progress" value={`${p.progress.percent}%`} hint={`${p.progress.completedSessions}/${p.prescribedSessions} sessions`} />
        <Stat label="Upcoming" value={p.progress.upcomingSessions} />
        <Stat label="Frequency" value={`${p.frequencyPerWeek}× / wk`} hint={`${p.sessionMinutes} min each`} />
        <Stat label="Package balance" value={p.patientPackages.find((x) => x.status === "ACTIVE")?.remainingSessions ?? "—"} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card space-y-2 text-sm">
          <h2 className="font-bold">Clinical summary</h2>
          {p.consultation && <div><span className="text-navy-500">Complaint:</span> {p.consultation.chiefComplaint}</div>}
          {p.consultation?.assessment && <div><span className="text-navy-500">Initial pain:</span> {p.consultation.assessment.painScore}/10 {p.consultation.assessment.painLocation && `(${p.consultation.assessment.painLocation})`}</div>}
          <div><span className="text-navy-500">Diagnosis:</span> {p.diagnosis ?? "—"}</div>
          <div><span className="text-navy-500">Goals:</span> {p.goals ?? "—"}</div>
          <div><span className="text-navy-500">Instructions:</span> {p.instructions ?? "—"}</div>
        </div>
        <div className="card">
          <h2 className="mb-2 font-bold">Prescribed treatments</h2>
          <div className="table-wrap-sm"><table className="table">
            <thead><tr><th>Category</th><th>Treatment</th><th>Dosage</th></tr></thead>
            <tbody>
              {p.items.map((i) => (
                <tr key={i.id}><td>{i.category}</td><td className="font-medium">{i.name}</td><td>{[i.sets && `${i.sets} sets`, i.reps && `${i.reps} reps`, i.durationMinutes && `${i.durationMinutes} min`].filter(Boolean).join(" · ") || "—"}</td></tr>
              ))}
            </tbody>
          </table></div>
        </div>
        <div className="card lg:col-span-2">
          <h2 className="mb-2 font-bold">Sessions</h2>
          <div className="table-wrap-sm"><table className="table">
            <thead><tr><th>#</th><th>Status</th><th>Pain before</th><th>Pain after</th><th>Completed</th></tr></thead>
            <tbody>
              {p.therapySessions.map((s) => (
                <tr key={s.id}><td>{s.sessionNumber}</td><td><StatusBadge status={s.status} /></td><td>{s.painBefore ?? "—"}</td><td>{s.painAfter ?? "—"}</td><td>{date(s.completedAt)}</td></tr>
              ))}
            </tbody>
          </table></div>
        </div>
      </div>
      <Modal open={editing} onClose={() => setEditing(false)} title={`Edit plan · ${p.planNo}`} wide>
        {editing && <PlanForm plan={p} onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} />}
      </Modal>
      <Modal open={cancelling} onClose={() => setCancelling(false)} title="Cancel this plan?">
        <div className="space-y-3">
          <p className="text-sm text-navy-700">The plan stays in the patient&apos;s record as cancelled. Booked visits under it must be cancelled first.</p>
          <Field label="Reason"><textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <ErrorText error={cancel.error} />
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setCancelling(false)}>Keep plan</button>
            <button className="btn-primary bg-rose-600 hover:bg-rose-700" disabled={reason.trim().length < 2 || cancel.isPending} onClick={() => cancel.mutate()}>Cancel plan</button>
          </div>
        </div>
      </Modal>
      <ConfirmDelete
        open={deleting}
        title={`Delete ${p.title}?`}
        message={
          nothingDone ? (
            <>This removes the plan <b>{p.planNo}</b> for {fullName(p.patient)}. Use this for plans created by mistake.</>
          ) : (
            <>This plan already has sessions done or booked, so it&apos;s part of the medical record and can&apos;t be deleted. Use <b>Cancel plan</b> instead.</>
          )
        }
        onCancel={() => setDeleting(false)}
        onConfirm={() => remove.mutate()}
        busy={remove.isPending}
        error={remove.error}
      />
    </>
  );
}
