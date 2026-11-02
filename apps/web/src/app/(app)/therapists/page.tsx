"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCog, KeyRound, Plus, Smartphone, Trash2 } from "lucide-react";
import { PinBadge, PinFields, pinProblem, SetPinModal } from "@/components/pin";
import { ConfirmDelete, Empty, ErrorText, Field, Modal, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth-store";
import { addDays, today } from "@/lib/format";
import type { Therapist } from "@/lib/types";
import { refresh } from "@/lib/invalidate";

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
type Day = { dayOfWeek: string; on: boolean; startTime: string; endTime: string; breakStart: string; breakEnd: string; slotMinutes: number };

export default function TherapistsPage() {
  const user = useAuth((s) => s.user);
  const isAdmin = hasRole(user, "ADMIN");
  const [adding, setAdding] = useState(false);
  const [scheduleFor, setScheduleFor] = useState<Therapist | null>(null);
  const [leaveFor, setLeaveFor] = useState<Therapist | null>(null);
  const [deleting, setDeleting] = useState<Therapist | null>(null);
  const [pinFor, setPinFor] = useState<{ id: string; name: string; hasPin?: boolean } | null>(null);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["therapists"], queryFn: () => api.get<Therapist[]>("/therapists", { includeInactive: isAdmin || undefined }) });
  const remove = useMutation({
    mutationFn: (t: Therapist) => api.del(`/therapists/${t.id}`),
    onSuccess: () => { refresh(qc, "therapists"); setDeleting(null); },
  });

  return (
    <>
      <PageHeader title="Physiotherapists" actions={isAdmin && <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={16} /> Add physiotherapist</button>} />
      {q.isLoading ? <Spinner /> : !q.data?.length ? <Empty>No physiotherapists yet.</Empty> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {q.data.map((t) => (
            <div key={t.id} className={`card ${t.isActive ? "" : "opacity-50"}`} style={{ borderTop: `4px solid ${t.colorTag ?? "#c9a14a"}` }}>
              <h3 className="text-lg font-bold">{t.user.name}</h3>
              <p className="text-sm text-navy-500">{t.qualification} · {t.experienceYears} yrs experience</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {t.specializations.map((s) => <span key={s.specialization.id} className="badge bg-gold-100 text-gold-700">{s.specialization.name}</span>)}
                {t.isAvailableForHomeVisit && <span className="badge bg-navy-50 text-navy-700">Home visits</span>}
              </div>
              <p className="mt-2 text-xs text-navy-500">{t.user.phone} · {t.user.email}</p>
              {isAdmin && <div className="mt-2"><PinBadge hasPin={t.user.hasPin} /></div>}
              {isAdmin && (
                <div className="mt-4 flex gap-2">
                  <button className="btn-ghost px-3 py-1 text-xs" onClick={() => setScheduleFor(t)}><CalendarCog size={14} /> Schedule</button>
                  <button className="btn-ghost px-3 py-1 text-xs" onClick={() => setLeaveFor(t)}>Leave</button>
                  <button className="btn-ghost px-3 py-1 text-xs" onClick={() => setPinFor({ id: t.user.id, name: t.user.name, hasPin: t.user.hasPin })}><KeyRound size={14} /> {t.user.hasPin ? "Reset PIN" : "Set PIN"}</button>
                  <button className="btn-ghost ml-auto px-3 py-1 text-xs text-rose-600" onClick={() => { remove.reset(); setDeleting(t); }}><Trash2 size={14} /> Delete</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {adding && <AddTherapist onClose={() => setAdding(false)} />}
      {scheduleFor && <ScheduleEditor therapist={scheduleFor} onClose={() => setScheduleFor(null)} />}
      {leaveFor && <LeaveForm therapist={leaveFor} onClose={() => setLeaveFor(null)} />}
      <SetPinModal user={pinFor} onClose={() => setPinFor(null)} />
      <ConfirmDelete
        open={!!deleting}
        title={`Delete ${deleting?.user.name ?? ""}?`}
        message={<>This removes <b>{deleting?.user.name}</b> from Movement Hub: they can no longer sign in, and their free slots disappear from booking. Past consultations, sessions and patient records stay for history. Any upcoming appointments must be rescheduled first.</>}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
        busy={remove.isPending}
        error={remove.error}
      />
    </>
  );
}

function AddTherapist({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const specs = useQuery({ queryKey: ["specializations"], queryFn: () => api.get<{ id: string; name: string }[]>("/specializations") });
  const [f, setF] = useState({ name: "", email: "", phone: "", password: "", qualification: "BPT", experienceYears: 0, colorTag: "#1b2160", isAvailableForHomeVisit: false, specializationIds: [] as string[] });
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const m = useMutation({ mutationFn: () => api.post("/therapists", { ...f, pin }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["therapists"] }); onClose(); } });
  const invalid = !f.name.trim() || !f.email.trim() || !f.phone.trim() || f.password.length < 8 || !!pinProblem(pin, confirm);
  return (
    <Modal open onClose={onClose} title="Add physiotherapist" wide>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Full name *"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Email *"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Mobile number *"><input className="input" inputMode="tel" placeholder="98765 43210" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Web password * (min 8 characters)"><input className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <div className="rounded-lg border border-gold-300 bg-gold-100/40 p-3 md:col-span-2">
          <div className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gold-700"><Smartphone size={13} /> Mobile app sign-in</div>
          <PinFields pin={pin} confirm={confirm} onPin={setPin} onConfirm={setConfirm} />
        </div>
        <Field label="Qualification"><input className="input" value={f.qualification} onChange={(e) => setF({ ...f, qualification: e.target.value })} /></Field>
        <Field label="Experience (years)"><input className="input" type="number" min={0} value={f.experienceYears} onChange={(e) => setF({ ...f, experienceYears: Number(e.target.value) })} /></Field>
        <Field label="Calendar colour"><input className="input h-10" type="color" value={f.colorTag} onChange={(e) => setF({ ...f, colorTag: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isAvailableForHomeVisit} onChange={(e) => setF({ ...f, isAvailableForHomeVisit: e.target.checked })} /> Does home visits</label>
        <div className="md:col-span-2">
          <span className="label">Specializations</span>
          <div className="flex flex-wrap gap-2">
            {specs.data?.map((s) => {
              const on = f.specializationIds.includes(s.id);
              return <button key={s.id} type="button" onClick={() => setF({ ...f, specializationIds: on ? f.specializationIds.filter((x) => x !== s.id) : [...f.specializationIds, s.id] })} className={`rounded-full border px-3 py-1 text-sm ${on ? "border-gold-500 bg-gold-100" : "border-navy-100"}`}>{s.name}</button>;
            })}
          </div>
        </div>
        <div className="md:col-span-2"><ErrorText error={m.error} /></div>
        <div className="flex justify-end gap-2 md:col-span-2"><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={invalid || m.isPending} onClick={() => m.mutate()}>{m.isPending ? "Creating…" : "Create"}</button></div>
      </div>
    </Modal>
  );
}

function ScheduleEditor({ therapist, onClose }: { therapist: Therapist; onClose: () => void }) {
  const qc = useQueryClient();
  const current = useQuery({
    queryKey: ["schedule", therapist.id],
    queryFn: () => api.get<{ dayOfWeek: string; startTime: string; endTime: string; breakStart: string | null; breakEnd: string | null; slotMinutes: number }[]>(`/therapists/${therapist.id}/schedule`),
  });
  const [days, setDays] = useState<Day[] | null>(null);
  const rows: Day[] =
    days ??
    DAYS.map((d) => {
      const s = current.data?.find((x) => x.dayOfWeek === d);
      return { dayOfWeek: d, on: !!s, startTime: s?.startTime ?? "09:00", endTime: s?.endTime ?? "18:00", breakStart: s?.breakStart ?? "13:00", breakEnd: s?.breakEnd ?? "14:00", slotMinutes: s?.slotMinutes ?? 30 };
    });
  const upd = (i: number, patch: Partial<Day>) => setDays(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = useMutation({
    mutationFn: () =>
      api.put(`/therapists/${therapist.id}/schedule`, {
        regenerateDays: 30,
        days: rows.filter((r) => r.on).map(({ on: _on, breakStart, breakEnd, ...r }) => ({ ...r, ...(breakStart && breakEnd ? { breakStart, breakEnd } : {}) })),
      }),
    onSuccess: () => { refresh(qc, "therapists"); onClose(); },
  });
  const generate = useMutation({ mutationFn: () => api.post<{ created: number }>(`/therapists/${therapist.id}/slots/generate`, { from: today(), to: addDays(today(), 30) }), onSuccess: (r) => alert(`${r.created} new slots created`) });

  return (
    <Modal open onClose={onClose} title={`Weekly schedule · ${therapist.user.name}`} wide>
      {current.isLoading ? <Spinner /> : (
        <div className="space-y-2">
          <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-navy-500"><span className="col-span-2">Day</span><span className="col-span-2">Start</span><span className="col-span-2">End</span><span className="col-span-2">Break from</span><span className="col-span-2">Break to</span><span className="col-span-2">Slot (min)</span></div>
          {rows.map((r, i) => (
            <div key={r.dayOfWeek} className="grid grid-cols-12 items-center gap-2">
              <label className="col-span-2 flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={r.on} onChange={(e) => upd(i, { on: e.target.checked })} />{r.dayOfWeek}</label>
              <input className="input col-span-2" type="time" disabled={!r.on} value={r.startTime} onChange={(e) => upd(i, { startTime: e.target.value })} />
              <input className="input col-span-2" type="time" disabled={!r.on} value={r.endTime} onChange={(e) => upd(i, { endTime: e.target.value })} />
              <input className="input col-span-2" type="time" disabled={!r.on} value={r.breakStart} onChange={(e) => upd(i, { breakStart: e.target.value })} />
              <input className="input col-span-2" type="time" disabled={!r.on} value={r.breakEnd} onChange={(e) => upd(i, { breakEnd: e.target.value })} />
              <select className="input col-span-2" disabled={!r.on} value={r.slotMinutes} onChange={(e) => upd(i, { slotMinutes: Number(e.target.value) })}>{[15, 20, 30, 45, 60].map((m) => <option key={m}>{m}</option>)}</select>
            </div>
          ))}
          <p className="text-xs text-navy-500">Saving rebuilds free slots for the next 30 days. Booked appointments are never touched.</p>
          <ErrorText error={save.error ?? generate.error} />
          <div className="flex justify-between gap-2">
            <button className="btn-ghost" onClick={() => generate.mutate()} disabled={generate.isPending}>Generate next 30 days</button>
            <div className="flex gap-2"><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>Save schedule</button></div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function LeaveForm({ therapist, onClose }: { therapist: Therapist; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ startDate: today(), endDate: today(), reason: "" });
  const m = useMutation({
    mutationFn: () => api.post<{ conflicts: { appointmentNo: string }[] }>(`/therapists/${therapist.id}/leaves`, { ...f, reason: f.reason || undefined }),
    onSuccess: (r) => {
      refresh(qc, "therapists");
      if (r.conflicts.length) alert(`Leave saved. ${r.conflicts.length} appointment(s) need rescheduling: ${r.conflicts.map((c) => c.appointmentNo).join(", ")}`);
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={`Leave · ${therapist.user.name}`}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From"><input className="input" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
        <Field label="To"><input className="input" type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
        <div className="col-span-2"><Field label="Reason"><input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field></div>
        <div className="col-span-2"><ErrorText error={m.error} /></div>
        <div className="col-span-2 flex justify-end gap-2"><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={m.isPending} onClick={() => m.mutate()}>Save leave</button></div>
      </div>
    </Modal>
  );
}
