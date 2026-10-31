"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, CheckCircle2, Save, Trash2 } from "lucide-react";
import { ConfirmDelete, ErrorText, Field, PageHeader, Spinner, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth-store";
import { dateTime, fullName, label } from "@/lib/format";
import type { Appointment, TreatmentPlan } from "@/lib/types";

type AppointmentDetail = Appointment & {
  history: { id: string; fromStatus: string | null; toStatus: string; note: string | null; createdAt: string }[];
};

interface Consultation {
  id: string;
  chiefComplaint: string;
  symptoms: string | null;
  historyOfIllness: string | null;
  clinicalImpression: string | null;
  recommendations: string | null;
  assessment: { painScore: number; painLocation: string | null; observations: string | null } | null;
}

const TYPES = ["INITIAL_CONSULTATION", "FOLLOW_UP_CONSULTATION", "THERAPY_SESSION", "HOME_VISIT"];

export default function AppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const justBooked = useSearchParams().get("booked") === "1";
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const isAdmin = hasRole(user, "ADMIN");
  const canManage = hasRole(user, "ADMIN", "RECEPTIONIST");
  const canClinical = hasRole(user, "ADMIN", "PHYSIOTHERAPIST");

  const q = useQuery({ queryKey: ["appointment", id], queryFn: () => api.get<AppointmentDetail>(`/appointments/${id}`) });
  const a = q.data;
  const open = a ? ["SCHEDULED", "CONFIRMED"].includes(a.status) : false;

  const plans = useQuery({
    queryKey: ["plans", a?.patient.id, "active"],
    queryFn: () => api.page<TreatmentPlan>("/treatment-plans", { patientId: a!.patient.id, status: "ACTIVE" }),
    enabled: !!a && open && canManage,
  });
  const consult = useQuery({
    queryKey: ["consultation", a?.consultation?.id],
    queryFn: () => api.get<Consultation>(`/consultations/${a!.consultation!.id}`),
    enabled: !!a?.consultation && canClinical,
  });

  /* ── appointment edit form ── */
  const [form, setForm] = useState({ type: "", treatmentPlanId: "", notes: "" });
  useEffect(() => {
    if (a) setForm({ type: a.type, treatmentPlanId: a.treatmentPlan?.id ?? "", notes: a.notes ?? "" });
  }, [a]);
  const saveAppt = useMutation({
    mutationFn: () =>
      api.patch(`/appointments/${id}`, {
        notes: form.notes,
        ...(open && canManage && form.type !== "HOME_VISIT" ? { type: form.type, treatmentPlanId: form.treatmentPlanId || null } : {}),
      }),
    onSuccess: () => qc.invalidateQueries(),
  });

  /* ── consultation edit form ── */
  const [c, setC] = useState({ chiefComplaint: "", symptoms: "", historyOfIllness: "", clinicalImpression: "", recommendations: "", painScore: 0, painLocation: "", observations: "" });
  useEffect(() => {
    const d = consult.data;
    if (d)
      setC({
        chiefComplaint: d.chiefComplaint,
        symptoms: d.symptoms ?? "",
        historyOfIllness: d.historyOfIllness ?? "",
        clinicalImpression: d.clinicalImpression ?? "",
        recommendations: d.recommendations ?? "",
        painScore: d.assessment?.painScore ?? 0,
        painLocation: d.assessment?.painLocation ?? "",
        observations: d.assessment?.observations ?? "",
      });
  }, [consult.data]);
  const saveConsult = useMutation({
    mutationFn: async () => {
      const cid = a!.consultation!.id;
      await api.patch(`/consultations/${cid}`, {
        chiefComplaint: c.chiefComplaint,
        symptoms: c.symptoms || undefined,
        historyOfIllness: c.historyOfIllness || undefined,
        clinicalImpression: c.clinicalImpression || undefined,
        recommendations: c.recommendations || undefined,
      });
      await api.put(`/consultations/${cid}/assessment`, { painScore: Number(c.painScore), painLocation: c.painLocation || undefined, observations: c.observations || undefined });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["consultation"] }),
  });

  /* ── delete ── */
  const [deleting, setDeleting] = useState(false);
  const remove = useMutation({
    mutationFn: () => api.del(`/appointments/${id}`),
    onSuccess: () => {
      qc.invalidateQueries();
      router.push("/appointments");
    },
  });

  if (q.isLoading) return <Spinner />;
  if (!a) return <ErrorText error={q.error} />;

  const hasClinical = !!a.consultation || ["COMPLETED", "IN_PROGRESS", "CHECKED_IN"].includes(a.status);
  const canDelete = isAdmin || (canManage && !hasClinical);

  return (
    <>
      <PageHeader
        title={`Appointment ${a.appointmentNo}`}
        subtitle={`${fullName(a.patient)} · ${label(a.type)} · ${dateTime(a.startAt)} with ${a.therapist.user.name}`}
        actions={
          <>
            <Link href="/appointments" className="btn-ghost"><ArrowLeft size={16} /> Back</Link>
            {canManage && open && <Link href={`/appointments/book?reschedule=${a.id}`} className="btn-ghost"><CalendarClock size={16} /> Reschedule</Link>}
            {canDelete && <button className="btn-ghost text-rose-600" onClick={() => { remove.reset(); setDeleting(true); }}><Trash2 size={16} /> Delete</button>}
          </>
        }
      />

      {justBooked && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 size={18} />
          <span className="font-semibold">Booked.</span>
          <span>
            {fullName(a.patient)} · {label(a.type)} · {dateTime(a.startAt)} with {a.therapist.user.name}
          </span>
          <Link href="/appointments/book" className="ml-auto font-semibold text-emerald-900 underline">Book another</Link>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Details + edit */}
        <div className="card space-y-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">Appointment details</h2>
            <StatusBadge status={a.status} />
          </div>
          <div className="grid gap-3 text-sm md:grid-cols-3">
            <div><div className="label">Patient</div><Link href={`/patients/${a.patient.id}`} className="font-semibold hover:underline">{fullName(a.patient)}</Link><div className="text-xs text-navy-500">{a.patient.patientCode} · {a.patient.phone}</div></div>
            <div><div className="label">Date &amp; time</div><div className="font-semibold">{dateTime(a.startAt)}</div></div>
            <div><div className="label">Physiotherapist</div><div className="font-semibold">{a.therapist.user.name}</div></div>
          </div>

          {open && canManage && a.type !== "HOME_VISIT" && !a.consultation ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Appointment type">
                <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  {TYPES.filter((t) => t !== "HOME_VISIT").map((t) => <option key={t} value={t}>{label(t)}</option>)}
                </select>
              </Field>
              <Field label={`Treatment plan${form.type === "THERAPY_SESSION" ? " *" : ""}`}>
                <select className="input" value={form.treatmentPlanId} onChange={(e) => setForm({ ...form, treatmentPlanId: e.target.value })}>
                  <option value="">{plans.data?.data.length ? "None" : "No active plan"}</option>
                  {plans.data?.data.map((p) => <option key={p.id} value={p.id}>{p.title} · {p.therapist.user.name}</option>)}
                </select>
              </Field>
            </div>
          ) : (
            <div className="grid gap-3 text-sm md:grid-cols-2">
              <div><div className="label">Type</div>{label(a.type)}</div>
              <div><div className="label">Treatment plan</div>{a.treatmentPlan ? <Link className="hover:underline" href={`/treatment-plans/${a.treatmentPlan.id}`}>{a.treatmentPlan.title}</Link> : "—"}</div>
              {!open && <p className="text-xs text-navy-500 md:col-span-2">Type and plan are locked once the visit has started. Notes can still be edited.</p>}
            </div>
          )}

          <Field label="Notes"><textarea className="input" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          <ErrorText error={saveAppt.error} />
          <div className="flex items-center justify-end gap-3">
            {saveAppt.isSuccess && <span className="text-sm text-emerald-700">Saved ✓</span>}
            <button className="btn-primary" disabled={saveAppt.isPending} onClick={() => saveAppt.mutate()}><Save size={16} /> Save changes</button>
          </div>
        </div>

        {/* History */}
        <div className="card">
          <h2 className="mb-3 font-bold">History</h2>
          <ol className="space-y-3 text-sm">
            {a.history.map((h) => (
              <li key={h.id} className="border-l-2 border-gold-300 pl-3">
                <div className="font-medium">{h.fromStatus && h.fromStatus !== h.toStatus ? `${label(h.fromStatus)} → ${label(h.toStatus)}` : label(h.toStatus)}</div>
                {h.note && <div className="text-xs text-navy-500">{h.note}</div>}
                <div className="text-xs text-navy-500">{dateTime(h.createdAt)}</div>
              </li>
            ))}
          </ol>
        </div>

        {/* Consultation notes */}
        {a.consultation && canClinical && (
          <div className="card space-y-4 lg:col-span-3">
            <h2 className="font-bold">Consultation notes</h2>
            {consult.isLoading ? <Spinner /> : (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Chief complaint *"><input className="input" value={c.chiefComplaint} onChange={(e) => setC({ ...c, chiefComplaint: e.target.value })} /></Field>
                  <Field label="Symptoms"><input className="input" value={c.symptoms} onChange={(e) => setC({ ...c, symptoms: e.target.value })} /></Field>
                  <Field label="History of present illness"><textarea className="input" rows={2} value={c.historyOfIllness} onChange={(e) => setC({ ...c, historyOfIllness: e.target.value })} /></Field>
                  <Field label="Clinical impression"><textarea className="input" rows={2} value={c.clinicalImpression} onChange={(e) => setC({ ...c, clinicalImpression: e.target.value })} /></Field>
                  <Field label="Recommendations"><textarea className="input" rows={2} value={c.recommendations} onChange={(e) => setC({ ...c, recommendations: e.target.value })} /></Field>
                  <Field label="Observations"><textarea className="input" rows={2} value={c.observations} onChange={(e) => setC({ ...c, observations: e.target.value })} /></Field>
                  <Field label={`Pain score: ${c.painScore}/10`}><input type="range" min={0} max={10} className="w-full accent-[#c9a14a]" value={c.painScore} onChange={(e) => setC({ ...c, painScore: Number(e.target.value) })} /></Field>
                  <Field label="Pain location"><input className="input" value={c.painLocation} onChange={(e) => setC({ ...c, painLocation: e.target.value })} /></Field>
                </div>
                <ErrorText error={saveConsult.error} />
                <div className="flex items-center justify-end gap-3">
                  {saveConsult.isSuccess && <span className="text-sm text-emerald-700">Saved ✓</span>}
                  <button className="btn-primary" disabled={c.chiefComplaint.trim().length < 2 || saveConsult.isPending} onClick={() => saveConsult.mutate()}><Save size={16} /> Save consultation</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <ConfirmDelete
        open={deleting}
        title={`Delete ${a.appointmentNo}?`}
        message={
          hasClinical ? (
            <>
              This appointment is <b>{label(a.status).toLowerCase()}</b>{a.consultation ? " and has consultation notes" : ""}. Deleting it permanently removes the visit
              {a.consultation ? " and its consultation notes" : ""} from {fullName(a.patient)}&apos;s record. Any package session it used is given back.
              Treatment plans written from it are kept.
            </>
          ) : (
            <>This permanently removes the booking for {fullName(a.patient)} on {dateTime(a.startAt)} and frees the time slot.</>
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
