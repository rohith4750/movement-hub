"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { PlanForm } from "@/components/plan-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ConfirmDelete, ErrorText, Field, Modal, PageHeader, Spinner, Stat, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth-store";
import { date, fullName, today } from "@/lib/format";
import { OUTCOME_LABEL, type PlanProgress, type TreatmentOutcome, type TreatmentPlan } from "@/lib/types";

type PlanDetail = TreatmentPlan & {
  progress: PlanProgress;
  consultation: { chiefComplaint: string | null; clinicalImpression: string | null; assessment: { painScore: number; painLocation: string | null; diagnosis: string | null } | null } | null;
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
  const [completing, setCompleting] = useState(false);
  const act = useMutation({
    mutationFn: (action: "activate") => api.post(`/treatment-plans/${id}/${action}`),
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
            {canManage && p.status === "ACTIVE" && <button className="btn-gold" onClick={() => setCompleting(true)}>Complete treatment</button>}
            {canManage && open && <button className="btn-ghost text-rose-600" onClick={() => { cancel.reset(); setCancelling(true); }}>Cancel plan</button>}
            {canManage && <button className="btn-ghost text-rose-600" title={nothingDone ? "Delete plan" : "Plans with sessions can't be deleted — cancel instead"} onClick={() => { remove.reset(); setDeleting(true); }}><Trash2 size={14} /> Delete</button>}
          </>
        }
      />
      <ErrorText error={act.error} />
      {canManage && p.status === "ACTIVE" && p.progress.readyToComplete && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gold-300 bg-gold-100 px-4 py-3 text-sm text-navy-900">
          <span>All {p.prescribedSessions} prescribed sessions are done. Record the outcome and complete the treatment.</span>
          <button className="btn-gold" onClick={() => setCompleting(true)}>Complete treatment</button>
        </div>
      )}
      {p.status === "COMPLETED" && p.outcome && (
        <div className="card mb-6 space-y-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold">Discharge summary</h2>
            <span className="text-navy-500">Completed {date(p.completedAt ?? null)}</span>
          </div>
          <div><span className="text-navy-500">Outcome:</span> <b>{OUTCOME_LABEL[p.outcome]}</b></div>
          {p.finalPainScore != null && (
            <div>
              <span className="text-navy-500">Pain:</span> {p.consultation?.assessment ? `${p.consultation.assessment.painScore}/10 → ` : ""}{p.finalPainScore}/10
            </div>
          )}
          {p.dischargeSummary && <div className="whitespace-pre-wrap"><span className="text-navy-500">Summary:</span> {p.dischargeSummary}</div>}
          {p.homeProgram && <div className="whitespace-pre-wrap"><span className="text-navy-500">Home program:</span> {p.homeProgram}</div>}
        </div>
      )}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Progress" value={`${p.progress.percent}%`} hint={`${p.progress.completedSessions}/${p.prescribedSessions} sessions`} />
        <Stat label="Upcoming" value={p.progress.upcomingSessions} />
        <Stat label="Frequency" value={`${p.frequencyPerWeek}× / wk`} hint={`${p.sessionMinutes} min each`} />
        <Stat label="Package balance" value={p.patientPackages.find((x) => x.status === "ACTIVE")?.remainingSessions ?? "—"} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card space-y-2 text-sm">
          <h2 className="font-bold">Clinical summary</h2>
          {p.consultation?.chiefComplaint && <div><span className="text-navy-500">Complaint:</span> {p.consultation.chiefComplaint}</div>}
          {p.consultation?.assessment?.diagnosis && <div><span className="text-navy-500">Assessment diagnosis:</span> {p.consultation.assessment.diagnosis}</div>}
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
        <DailyProgress planId={p.id} canRecord={canManage} />
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
      <Modal open={completing} onClose={() => setCompleting(false)} title={`Complete treatment · ${p.planNo}`}>
        {completing && <CompleteTreatment plan={p} onDone={() => { setCompleting(false); refresh(); qc.invalidateQueries({ queryKey: ["appointments"] }); qc.invalidateQueries({ queryKey: ["patient", p.patient.id] }); }} onCancel={() => setCompleting(false)} />}
      </Modal>
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

const OUTCOMES = Object.keys(OUTCOME_LABEL) as TreatmentOutcome[];

/** Discharge form: outcome, final pain, summary, home program. Cancels still-booked visits on request. */
function CompleteTreatment({ plan, onDone, onCancel }: { plan: PlanDetail; onDone: () => void; onCancel: () => void }) {
  const short = plan.progress.completedSessions < plan.prescribedSessions;
  const [outcome, setOutcome] = useState<TreatmentOutcome>(short ? "PARTIALLY_MET" : "GOALS_MET");
  const [finalPain, setFinalPain] = useState(plan.progress.latestPain != null ? String(plan.progress.latestPain) : "");
  const [summary, setSummary] = useState("");
  const [homeProgram, setHomeProgram] = useState("");
  const booked = plan.progress.bookedVisits;
  const m = useMutation({
    mutationFn: () =>
      api.post(`/treatment-plans/${plan.id}/complete`, {
        outcome,
        finalPainScore: finalPain === "" ? undefined : Number(finalPain),
        dischargeSummary: summary.trim() || undefined,
        homeProgram: homeProgram.trim() || undefined,
        cancelUpcoming: booked > 0,
      }),
    onSuccess: onDone,
  });
  const painOk = finalPain === "" || (/^\d+$/.test(finalPain) && Number(finalPain) <= 10);

  return (
    <div className="space-y-3">
      <p className="text-sm text-navy-700">
        {plan.progress.completedSessions} of {plan.prescribedSessions} prescribed sessions done.
        {short && " The plan will close early."} It can&apos;t be edited after this.
      </p>
      {booked > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {booked} visit{booked === 1 ? " is" : "s are"} still booked under this plan. Completing will cancel {booked === 1 ? "it" : "them"}, free the slot{booked === 1 ? "" : "s"} and notify the patient.
        </div>
      )}
      <Field label="Outcome">
        <select className="input" value={outcome} onChange={(e) => setOutcome(e.target.value as TreatmentOutcome)}>
          {OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
        </select>
      </Field>
      <Field label="Final pain score (0–10)">
        <input className="input" inputMode="numeric" value={finalPain} onChange={(e) => setFinalPain(e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="e.g. 2" />
      </Field>
      <Field label="Discharge summary">
        <textarea className="input" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Progress made, current function, reason for discharge" />
      </Field>
      <Field label="Home exercise program">
        <textarea className="input" rows={3} value={homeProgram} onChange={(e) => setHomeProgram(e.target.value)} placeholder="Exercises and advice to continue at home" />
      </Field>
      <ErrorText error={m.error} />
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onCancel}>Back</button>
        <button className="btn-gold" disabled={!painOk || m.isPending} onClick={() => m.mutate()}>
          {booked > 0 ? `Cancel ${booked} visit${booked === 1 ? "" : "s"} & complete` : "Complete treatment"}
        </button>
      </div>
    </div>
  );
}

type ProgressDay = { date: string; painScore: number | null; status: "IMPROVED" | "SAME" | "WORSE" | null; notes: string | null; carriedForward: boolean; recordedOn: string | null; entryId: string | null };
const STATUS_LABEL = { IMPROVED: "Improved", SAME: "Same", WORSE: "Worse" } as const;
const STATUS_CLASS = { IMPROVED: "text-emerald-700", SAME: "text-navy-500", WORSE: "text-rose-600" } as const;

/**
 * Day-by-day progress. Days without an entry show the last recorded values ("carried forward")
 * until a new entry changes them.
 */
function DailyProgress({ planId, canRecord }: { planId: string; canRecord: boolean }) {
  const q = useQuery({ queryKey: ["progress-log", planId], queryFn: () => api.get<{ days: ProgressDay[]; entries: number; editable: boolean }>(`/treatment-plans/${planId}/progress-log`) });
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<ProgressDay | null>(null);
  const days = q.data?.days ?? [];
  const shown = showAll ? days : days.slice(0, 14);
  const canEdit = canRecord && !!q.data?.editable;
  const todayRow = days.find((d) => d.date === today());

  return (
    <div className="card lg:col-span-2">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">Daily progress</h2>
        {canEdit && (
          <button className="btn-gold" onClick={() => setEditing(todayRow ?? { date: today(), painScore: null, status: null, notes: null, carriedForward: false, recordedOn: null, entryId: null })}>
            Record today&apos;s progress
          </button>
        )}
      </div>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorText error={q.error} /> : !q.data?.entries ? (
        <p className="text-sm text-navy-500">No progress recorded yet.{canEdit ? " Record today’s pain and how the patient is doing." : ""}</p>
      ) : (
        <>
          <div className="table-wrap-sm"><table className="table">
            <thead><tr><th>Date</th><th>Pain</th><th>Status</th><th>Notes</th>{canEdit && <th />}</tr></thead>
            <tbody>
              {shown.map((d) => (
                <tr key={d.date} className={d.carriedForward ? "text-navy-500" : undefined}>
                  <td className="whitespace-nowrap">
                    {date(d.date)}
                    {d.carriedForward && d.recordedOn && <div className="text-xs italic">No entry · carried from {date(d.recordedOn)}</div>}
                  </td>
                  <td>{d.painScore != null ? `${d.painScore}/10` : "—"}</td>
                  <td className={d.status && !d.carriedForward ? STATUS_CLASS[d.status] : undefined}>{d.status ? STATUS_LABEL[d.status] : "—"}</td>
                  <td className="max-w-md whitespace-pre-wrap">{d.notes ?? "—"}</td>
                  {canEdit && <td><button className="text-xs font-semibold text-gold-700" onClick={() => setEditing(d)}>{d.entryId ? "Edit" : "Record"}</button></td>}
                </tr>
              ))}
            </tbody>
          </table></div>
          {days.length > 14 && (
            <button className="mt-2 text-sm font-semibold text-gold-700" onClick={() => setShowAll(!showAll)}>{showAll ? "Show last 14 days" : `Show all ${days.length} days`}</button>
          )}
        </>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing ? `Progress · ${date(editing.date)}` : ""}>
        {editing && <ProgressForm planId={planId} day={editing} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function ProgressForm({ planId, day, onDone }: { planId: string; day: ProgressDay; onDone: () => void }) {
  const qc = useQueryClient();
  // Pre-fill with the values in effect that day (recorded or carried forward); notes start fresh unless that day has its own entry.
  const [pain, setPain] = useState(day.painScore != null ? String(day.painScore) : "");
  const [status, setStatus] = useState<ProgressDay["status"]>(day.status);
  const [notes, setNotes] = useState(day.entryId ? day.notes ?? "" : "");
  const m = useMutation({
    mutationFn: () =>
      api.put(`/treatment-plans/${planId}/progress-log/${day.date}`, {
        painScore: pain === "" ? null : Number(pain),
        status,
        notes: notes.trim() || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["progress-log", planId] });
      qc.invalidateQueries({ queryKey: ["plan", planId] });
      onDone();
    },
  });
  const painOk = pain === "" || Number(pain) <= 10;
  const empty = pain === "" && !status && !notes.trim();

  return (
    <div className="space-y-3">
      <Field label="Pain score (0–10)">
        <input className="input" inputMode="numeric" value={pain} onChange={(e) => setPain(e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="e.g. 4" autoFocus />
      </Field>
      <div>
        <span className="label">Compared with last time</span>
        <div className="flex gap-2">
          {(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((k) => (
            <button key={k} type="button" className={status === k ? "btn-gold" : "btn-ghost"} onClick={() => setStatus(status === k ? null : k)}>{STATUS_LABEL[k]}</button>
          ))}
        </div>
      </div>
      <Field label="Notes">
        <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="How the patient is doing today" />
      </Field>
      <ErrorText error={m.error} />
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onDone}>Cancel</button>
        <button className="btn-primary" disabled={!painOk || empty || m.isPending} onClick={() => m.mutate()}>Save progress</button>
      </div>
    </div>
  );
}
