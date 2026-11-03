"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, PackagePlus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { ConfirmDelete, Empty, ErrorText, Field, Modal, PageHeader, Spinner, Stat, StatusBadge } from "@/components/ui";
import { PlanForm } from "@/components/plan-form";
import { api } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth-store";
import { ageFrom, date, dateTime, fullName, inr, label } from "@/lib/format";
import type { PackageDef } from "@/lib/types";
import { refresh } from "@/lib/invalidate";

interface PatientDetail {
  id: string; patientCode: string; patientType?: "REGULAR" | "WALK_IN"; firstName: string; lastName: string | null; gender: string; dateOfBirth: string | null; phone: string; email: string | null;
  emergencyName: string | null; emergencyPhone: string | null; referredBy: string | null; consentGiven: boolean;
  primaryTherapist: { id: string; user: { name: string } } | null;
  addresses: { id: string; label: string; line1: string; city: string; pincode: string }[];
  medicalHistory: { id: string; condition: string; details: string | null; isOngoing: boolean; medications: string | null; allergies: string | null }[];
  packages: { id: string; status: string; remainingSessions: number; totalSessions: number; expiryDate: string; package: { name: string } }[];
  treatmentPlans: { id: string; title: string; status: string; prescribedSessions: number; createdAt: string }[];
  appointments: { id: string; appointmentNo: string; type: string; status: string; startAt: string; therapist: { user: { name: string } } }[];
}

interface Progress {
  activePlan: { title: string; prescribedSessions: number; completedSessions: number; percent: number } | null;
  initialPain: number | null;
  latestPain: number | null;
  painReduction: number | null;
  timeline: { id: string; sessionNumber: number | null; completedAt: string; painBefore: number | null; painAfter: number | null }[];
}

export default function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const user = useAuth((s) => s.user);
  const [buying, setBuying] = useState(false);
  const [addingHistory, setAddingHistory] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api.del(`/patients/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["patients"] }); router.push("/patients"); },
  });
  const [deletingAppt, setDeletingAppt] = useState<PatientDetail["appointments"][number] | null>(null);
  const [newPlan, setNewPlan] = useState(false);
  const removeAppt = useMutation({
    mutationFn: (apptId: string) => api.del(`/appointments/${apptId}`),
    onSuccess: () => { refresh(qc, "appointments"); setDeletingAppt(null); },
  });
  const p = useQuery({ queryKey: ["patient", id], queryFn: () => api.get<PatientDetail>(`/patients/${id}`) });
  const canAssign = hasRole(user, "RECEPTIONIST", "ADMIN");
  const therapists = useQuery({ queryKey: ["therapists"], queryFn: () => api.get<{ id: string; user: { name: string } }[]>("/therapists"), enabled: canAssign });
  const assign = useMutation({
    mutationFn: (therapistId: string) => api.patch(`/patients/${id}`, { primaryTherapistId: therapistId || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["patient", id] }); qc.invalidateQueries({ queryKey: ["patients"] }); },
  });
  const progress = useQuery({ queryKey: ["progress", id], queryFn: () => api.get<Progress>(`/patients/${id}/progress`), enabled: hasRole(user, "PHYSIOTHERAPIST", "ADMIN") });

  if (p.isLoading) return <Spinner />;
  if (!p.data) return <ErrorText error={p.error} />;
  const d = p.data;
  const age = ageFrom(d.dateOfBirth);

  return (
    <>
      <PageHeader
        title={fullName(d)}
        subtitle={`${d.patientCode} · ${d.patientType === "WALK_IN" ? "Walk-in" : "Regular"} · ${label(d.gender)}${age !== null ? ` · ${age} yrs` : ""} · ${d.phone}`}
        actions={
          <>
            {hasRole(user, "ADMIN") && <button className="btn-ghost text-rose-600" onClick={() => { remove.reset(); setDeleting(true); }}><Trash2 size={16} /> Delete</button>}
            {hasRole(user, "RECEPTIONIST", "ADMIN") && <button className="btn-ghost" onClick={() => setBuying(true)}><PackagePlus size={16} /> Sell package</button>}
            {hasRole(user, "RECEPTIONIST", "ADMIN") && <Link href={`/appointments/book?patientId=${id}`} className="btn-primary"><CalendarPlus size={16} /> Book appointment</Link>}
          </>
        }
      />

      {progress.data && (
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Active plan" value={progress.data.activePlan ? `${progress.data.activePlan.percent}%` : "—"} hint={progress.data.activePlan ? `${progress.data.activePlan.completedSessions}/${progress.data.activePlan.prescribedSessions} sessions` : undefined} />
          <Stat label="Initial pain" value={progress.data.initialPain ?? "—"} hint="0–10 scale" />
          <Stat label="Latest pain" value={progress.data.latestPain ?? "—"} />
          <Stat label="Pain reduction" value={progress.data.painReduction !== null ? `${progress.data.painReduction} pts` : "—"} />
        </div>
      )}

      {progress.data && progress.data.timeline.length > 0 && (
        <div className="card mb-6">
          <h2 className="mb-3 font-bold">Pain trend</h2>
          <div className="flex h-36 items-end gap-2">
            {progress.data.timeline.map((s) => (
              <div key={s.id} className="flex flex-1 flex-col items-center gap-1" title={`Session ${s.sessionNumber}: ${s.painBefore} → ${s.painAfter}`}>
                <div className="flex w-full items-end justify-center gap-0.5" style={{ height: 110 }}>
                  <div className="w-1/3 rounded-t bg-navy-100" style={{ height: `${(s.painBefore ?? 0) * 10}%` }} />
                  <div className="w-1/3 rounded-t bg-gold-500" style={{ height: `${(s.painAfter ?? 0) * 10}%` }} />
                </div>
                <span className="text-[10px] text-navy-500">#{s.sessionNumber}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-navy-500"><span className="mr-1 inline-block h-2 w-2 bg-navy-100" />Before session <span className="ml-3 mr-1 inline-block h-2 w-2 bg-gold-500" />After session</p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card space-y-2 text-sm">
          <h2 className="mb-2 font-bold">Details</h2>
          <div className="flex items-center gap-2">
            <span className="text-navy-500">Regular physio:</span>
            {canAssign ? (
              <select className="input w-auto py-1 text-sm" value={d.primaryTherapist?.id ?? ""} disabled={assign.isPending} onChange={(e) => assign.mutate(e.target.value)}>
                <option value="">None</option>
                {therapists.data?.map((t) => <option key={t.id} value={t.id}>{t.user.name}</option>)}
              </select>
            ) : (
              d.primaryTherapist?.user.name ?? "—"
            )}
          </div>
          <ErrorText error={assign.error} />
          <div><span className="text-navy-500">Email:</span> {d.email ?? "—"}</div>
          <div><span className="text-navy-500">Date of birth:</span> {date(d.dateOfBirth)}{age !== null ? ` (${age} yrs)` : ""}</div>
          <div><span className="text-navy-500">Emergency:</span> {d.emergencyName ? `${d.emergencyName} (${d.emergencyPhone})` : "—"}</div>
          <div><span className="text-navy-500">Referred by:</span> {d.referredBy ?? "—"}</div>
          <div><span className="text-navy-500">Consent:</span> {d.consentGiven ? "Given" : <span className="text-rose-600">Not recorded</span>}</div>
          {d.addresses.map((a) => <div key={a.id}><span className="text-navy-500">{a.label}:</span> {a.line1}, {a.city} {a.pincode}</div>)}
        </div>

        <div className="card lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-bold">Medical history</h2>
            {hasRole(user, "PHYSIOTHERAPIST", "RECEPTIONIST") && <button className="text-sm font-semibold text-gold-700" onClick={() => setAddingHistory(true)}>+ Add</button>}
          </div>
          {d.medicalHistory.length === 0 ? <Empty>No history recorded.</Empty> : (
            <ul className="divide-y divide-navy-50 text-sm">
              {d.medicalHistory.map((h) => (
                <li key={h.id} className="py-2">
                  <span className="font-semibold">{h.condition}</span> {h.isOngoing && <StatusBadge status="ACTIVE" />}
                  {h.details && <div className="text-navy-500">{h.details}</div>}
                  {(h.medications || h.allergies) && <div className="text-xs text-navy-500">Medications: {h.medications ?? "—"} · Allergies: {h.allergies ?? "—"}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h2 className="mb-2 font-bold">Packages</h2>
          {d.packages.length === 0 ? <Empty>No packages.</Empty> : d.packages.map((pk) => (
            <div key={pk.id} className="mb-3 rounded-lg border border-navy-100 p-3 text-sm">
              <div className="flex justify-between"><b>{pk.package.name}</b><StatusBadge status={pk.status} /></div>
              <div className="text-navy-500">{pk.remainingSessions}/{pk.totalSessions} sessions left · expires {date(pk.expiryDate)}</div>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-bold">Treatment plans</h2>
            {hasRole(user, "PHYSIOTHERAPIST", "ADMIN") && <button className="text-sm font-semibold text-gold-700" onClick={() => setNewPlan(true)}>+ New plan</button>}
          </div>
          {d.treatmentPlans.length === 0 ? <Empty>No plans yet.</Empty> : d.treatmentPlans.map((t) => (
            <Link key={t.id} href={`/treatment-plans/${t.id}`} className="mb-2 block rounded-lg border border-navy-100 p-3 text-sm hover:border-gold-500">
              <div className="flex justify-between"><b>{t.title}</b><StatusBadge status={t.status} /></div>
              <div className="text-navy-500">{t.prescribedSessions} sessions · {date(t.createdAt)}</div>
            </Link>
          ))}
        </div>

        <div className="card">
          <h2 className="mb-2 font-bold">Recent appointments</h2>
          {d.appointments.length === 0 ? <Empty>No appointments.</Empty> : (
            <ul className="space-y-2 text-sm">
              {d.appointments.map((a) => (
                <li key={a.id} className="flex items-center justify-between">
                  <div><div className="font-medium">{dateTime(a.startAt)}</div><div className="text-xs text-navy-500">{label(a.type)} · {a.therapist.user.name}</div></div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={a.status} />
                    {hasRole(user, "ADMIN", "RECEPTIONIST") && !["COMPLETED", "IN_PROGRESS", "CHECKED_IN"].includes(a.status) && (
                      <button className="text-rose-600 hover:text-rose-800" title="Delete appointment" onClick={() => { removeAppt.reset(); setDeletingAppt(a); }}><Trash2 size={14} /></button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <SellPackage open={buying} onClose={() => setBuying(false)} patientId={id} />
      <AddHistory open={addingHistory} onClose={() => setAddingHistory(false)} patientId={id} />
      <Modal open={newPlan} onClose={() => setNewPlan(false)} title="New treatment plan" wide>
        {newPlan && <PlanForm patientId={id} onSaved={(planId) => { setNewPlan(false); router.push(`/treatment-plans/${planId}`); }} onCancel={() => setNewPlan(false)} />}
      </Modal>
      <ConfirmDelete
        open={!!deletingAppt}
        title={`Delete ${deletingAppt?.appointmentNo ?? ""}?`}
        message={<>This permanently removes the {label(deletingAppt?.type).toLowerCase()} on {dateTime(deletingAppt?.startAt)} with {deletingAppt?.therapist.user.name}, and frees the time slot. Use Cancel on the Appointments page if you want to keep a record of it.</>}
        onCancel={() => setDeletingAppt(null)}
        onConfirm={() => deletingAppt && removeAppt.mutate(deletingAppt.id)}
        busy={removeAppt.isPending}
        error={removeAppt.error}
      />
      <ConfirmDelete
        open={deleting}
        title={`Delete ${fullName(d)}?`}
        message={
          <>
            <b>{fullName(d)}</b> ({d.patientCode}) will be removed from the patient list and search, any active package is cancelled, and their app login stops working.
            Past consultations, sessions and invoices are kept for medical and tax records.
          </>
        }
        onCancel={() => setDeleting(false)}
        onConfirm={() => remove.mutate()}
        busy={remove.isPending}
        error={remove.error}
      />
    </>
  );
}

function SellPackage({ open, onClose, patientId }: { open: boolean; onClose: () => void; patientId: string }) {
  const qc = useQueryClient();
  const [packageId, setPackageId] = useState("");
  const [discount, setDiscount] = useState("0");
  const [reason, setReason] = useState("");
  const pkgs = useQuery({ queryKey: ["packages"], queryFn: () => api.get<PackageDef[]>("/packages"), enabled: open });
  const m = useMutation({
    mutationFn: () => api.post("/patient-packages", { patientId, packageId, discountAmount: Number(discount) || 0, discountReason: reason || undefined }),
    onSuccess: () => { refresh(qc, "packageSale"); onClose(); },
  });
  return (
    <Modal open={open} onClose={onClose} title="Sell treatment package">
      <div className="space-y-3">
        {pkgs.data?.map((p) => (
          <label key={p.id} className={`flex cursor-pointer items-center justify-between rounded-lg border p-3 ${packageId === p.id ? "border-gold-500 bg-gold-100" : "border-navy-100"}`}>
            <span><input type="radio" className="mr-2" checked={packageId === p.id} onChange={() => setPackageId(p.id)} /><b>{p.name}</b> · {p.sessionCount} sessions · {p.validityDays} days</span>
            <span className="font-bold">{inr(p.price)}</span>
          </label>
        ))}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Discount (₹)"><input className="input" type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field>
          <Field label="Discount reason"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
        <p className="text-xs text-navy-500">An invoice (with GST) is generated automatically. Collect payment from Billing.</p>
        <ErrorText error={m.error} />
        <div className="flex justify-end gap-2"><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!packageId || m.isPending} onClick={() => m.mutate()}>Create package &amp; invoice</button></div>
      </div>
    </Modal>
  );
}

function AddHistory({ open, onClose, patientId }: { open: boolean; onClose: () => void; patientId: string }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ condition: "", details: "", medications: "", allergies: "" });
  const m = useMutation({
    mutationFn: () => api.post(`/patients/${patientId}/medical-history`, Object.fromEntries(Object.entries(f).filter(([, v]) => v))),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["patient", patientId] }); onClose(); setF({ condition: "", details: "", medications: "", allergies: "" }); },
  });
  return (
    <Modal open={open} onClose={onClose} title="Add medical history">
      <div className="space-y-3">
        {(["condition", "details", "medications", "allergies"] as const).map((k) => (
          <Field key={k} label={label(k)}><input className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
        ))}
        <ErrorText error={m.error} />
        <div className="flex justify-end gap-2"><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!f.condition || m.isPending} onClick={() => m.mutate()}>Save</button></div>
      </div>
    </Modal>
  );
}
