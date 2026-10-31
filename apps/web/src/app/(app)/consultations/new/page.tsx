"use client";

import { Suspense, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { ErrorText, Field, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { fullName } from "@/lib/format";
import type { Appointment } from "@/lib/types";

type Item = { category: string; name: string; sets?: number; reps?: number; durationMinutes?: number };
const CATEGORIES = ["Manual Therapy", "Electrotherapy", "Exercise Therapy", "Taping", "Dry Needling", "Hot/Cold Therapy", "Traction", "Education"];

export default function NewConsultationPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ConsultationForm />
    </Suspense>
  );
}

/** Consultation + clinical assessment, optionally creating the treatment plan in the same step. */
function ConsultationForm() {
  const router = useRouter();
  const appointmentId = useSearchParams().get("appointmentId") ?? "";
  const appt = useQuery({ queryKey: ["appointment", appointmentId], queryFn: () => api.get<Appointment>(`/appointments/${appointmentId}`), enabled: !!appointmentId });

  const [c, setC] = useState({ chiefComplaint: "", symptoms: "", historyOfIllness: "", clinicalImpression: "", recommendations: "", followUpDate: "" });
  const [a, setA] = useState({ painScore: 5, painLocation: "", painType: "", aggravatingFactors: "", relievingFactors: "", posture: "", mobilityStatus: "", gait: "", observations: "" });
  const [rom, setRom] = useState<{ joint: string; value: string }[]>([]);
  const [tests, setTests] = useState<{ name: string; result: string }[]>([]);
  const [makePlan, setMakePlan] = useState(true);
  const [plan, setPlan] = useState({ title: "", diagnosis: "", goals: "", prescribedSessions: 10, frequencyPerWeek: 3, sessionMinutes: 30, instructions: "" });
  const [items, setItems] = useState<Item[]>([{ category: "Exercise Therapy", name: "" }]);

  // Remember what was already saved so pressing Save again after an error never creates duplicates.
  const createdPlanId = useRef<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v !== undefined));
      const planItems = items.filter((i) => i.name.trim()).map((i, n) => ({ ...i, name: i.name.trim(), sortOrder: n }));
      if (makePlan && !plan.title.trim()) throw new Error("Enter a plan title, or untick “Create treatment plan now”.");
      if (makePlan && planItems.length === 0) throw new Error("Add at least one prescribed treatment (e.g. Traction – Lumbar traction).");

      const assessment = {
        ...clean(a),
        painScore: Number(a.painScore),
        rangeOfMotion: rom.length ? Object.fromEntries(rom.filter((r) => r.joint).map((r) => [r.joint, r.value])) : undefined,
        specialTests: tests.filter((t) => t.name).length ? tests.filter((t) => t.name) : undefined,
      };

      // 1. Consultation — create, or update if it was saved on an earlier attempt
      const current = await api.get<Appointment>(`/appointments/${appointmentId}`);
      let consultationId = current.consultation?.id;
      if (consultationId) {
        await api.patch(`/consultations/${consultationId}`, clean(c));
        await api.put(`/consultations/${consultationId}/assessment`, assessment);
      } else {
        consultationId = (await api.post<{ id: string }>("/consultations", { appointmentId, ...clean(c), assessment })).id;
      }

      // 2. Treatment plan — owned by the physiotherapist on this appointment, created already active
      let planId: string | null = createdPlanId.current;
      if (makePlan && !planId) {
        const p = await api.post<{ id: string }>("/treatment-plans", {
          ...clean(plan),
          patientId: current.patient.id,
          consultationId,
          therapistId: current.therapist.id,
          prescribedSessions: Number(plan.prescribedSessions),
          frequencyPerWeek: Number(plan.frequencyPerWeek),
          sessionMinutes: Number(plan.sessionMinutes),
          activate: true,
          items: planItems,
        });
        planId = createdPlanId.current = p.id;
      }

      // 3. Close the appointment
      if (current.status !== "COMPLETED") await api.patch(`/appointments/${appointmentId}/complete`);
      return planId ? `/treatment-plans/${planId}` : `/patients/${current.patient.id}`;
    },
    onSuccess: (to) => router.push(to),
  });

  if (!appointmentId) return <ErrorText error="Open this page from an appointment." />;
  if (appt.isLoading) return <Spinner />;
  if (!appt.data) return <ErrorText error={appt.error} />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form onSubmit={submit}>
      <PageHeader title="Consultation & assessment" subtitle={`${fullName(appt.data.patient)} · ${appt.data.patient.patientCode} · ${appt.data.appointmentNo}`} />

      <div className="card mb-6 grid gap-4 md:grid-cols-2">
        <h2 className="font-bold md:col-span-2">Consultation</h2>
        <Field label="Chief complaint *"><input className="input" required value={c.chiefComplaint} onChange={(e) => setC({ ...c, chiefComplaint: e.target.value })} /></Field>
        <Field label="Symptoms"><input className="input" value={c.symptoms} onChange={(e) => setC({ ...c, symptoms: e.target.value })} /></Field>
        <Field label="History of present illness"><textarea className="input" rows={2} value={c.historyOfIllness} onChange={(e) => setC({ ...c, historyOfIllness: e.target.value })} /></Field>
        <Field label="Clinical impression"><textarea className="input" rows={2} value={c.clinicalImpression} onChange={(e) => setC({ ...c, clinicalImpression: e.target.value })} /></Field>
        <Field label="Recommendations"><textarea className="input" rows={2} value={c.recommendations} onChange={(e) => setC({ ...c, recommendations: e.target.value })} /></Field>
        <Field label="Follow-up date"><input className="input" type="date" value={c.followUpDate} onChange={(e) => setC({ ...c, followUpDate: e.target.value })} /></Field>
      </div>

      <div className="card mb-6 grid gap-4 md:grid-cols-3">
        <h2 className="font-bold md:col-span-3">Clinical assessment</h2>
        <Field label={`Pain score: ${a.painScore}/10`}><input type="range" min={0} max={10} className="w-full accent-[#c9a14a]" value={a.painScore} onChange={(e) => setA({ ...a, painScore: Number(e.target.value) })} /></Field>
        <Field label="Pain location"><input className="input" value={a.painLocation} onChange={(e) => setA({ ...a, painLocation: e.target.value })} /></Field>
        <Field label="Pain type"><input className="input" placeholder="sharp, dull, radiating…" value={a.painType} onChange={(e) => setA({ ...a, painType: e.target.value })} /></Field>
        <Field label="Aggravating factors"><input className="input" value={a.aggravatingFactors} onChange={(e) => setA({ ...a, aggravatingFactors: e.target.value })} /></Field>
        <Field label="Relieving factors"><input className="input" value={a.relievingFactors} onChange={(e) => setA({ ...a, relievingFactors: e.target.value })} /></Field>
        <Field label="Posture"><input className="input" value={a.posture} onChange={(e) => setA({ ...a, posture: e.target.value })} /></Field>
        <Field label="Mobility status"><input className="input" value={a.mobilityStatus} onChange={(e) => setA({ ...a, mobilityStatus: e.target.value })} /></Field>
        <Field label="Gait"><input className="input" value={a.gait} onChange={(e) => setA({ ...a, gait: e.target.value })} /></Field>
        <Field label="Observations"><input className="input" value={a.observations} onChange={(e) => setA({ ...a, observations: e.target.value })} /></Field>

        <div className="md:col-span-3">
          <span className="label">Range of motion</span>
          {rom.map((r, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <input className="input" placeholder="e.g. Shoulder flexion (L)" value={r.joint} onChange={(e) => setRom(rom.map((x, j) => (j === i ? { ...x, joint: e.target.value } : x)))} />
              <input className="input w-40" placeholder="e.g. 120°" value={r.value} onChange={(e) => setRom(rom.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
              <button type="button" className="btn-ghost" onClick={() => setRom(rom.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
            </div>
          ))}
          <button type="button" className="text-sm font-semibold text-gold-700" onClick={() => setRom([...rom, { joint: "", value: "" }])}>+ Add measurement</button>
        </div>
        <div className="md:col-span-3">
          <span className="label">Special tests</span>
          {tests.map((t, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <input className="input" placeholder="e.g. SLR" value={t.name} onChange={(e) => setTests(tests.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input className="input" placeholder="Result" value={t.result} onChange={(e) => setTests(tests.map((x, j) => (j === i ? { ...x, result: e.target.value } : x)))} />
              <button type="button" className="btn-ghost" onClick={() => setTests(tests.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
            </div>
          ))}
          <button type="button" className="text-sm font-semibold text-gold-700" onClick={() => setTests([...tests, { name: "", result: "" }])}>+ Add test</button>
        </div>
      </div>

      <div className="card mb-6">
        <label className="mb-4 flex items-center gap-2 font-bold"><input type="checkbox" checked={makePlan} onChange={(e) => setMakePlan(e.target.checked)} /> Create treatment plan now</label>
        {makePlan && (
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Plan title *"><input className="input" required={makePlan} value={plan.title} onChange={(e) => setPlan({ ...plan, title: e.target.value })} /></Field>
            <Field label="Diagnosis"><input className="input" value={plan.diagnosis} onChange={(e) => setPlan({ ...plan, diagnosis: e.target.value })} /></Field>
            <Field label="Goals"><input className="input" value={plan.goals} onChange={(e) => setPlan({ ...plan, goals: e.target.value })} /></Field>
            <Field label="Prescribed sessions"><input className="input" type="number" min={1} value={plan.prescribedSessions} onChange={(e) => setPlan({ ...plan, prescribedSessions: Number(e.target.value) })} /></Field>
            <Field label="Sessions per week"><input className="input" type="number" min={1} value={plan.frequencyPerWeek} onChange={(e) => setPlan({ ...plan, frequencyPerWeek: Number(e.target.value) })} /></Field>
            <Field label="Minutes per session"><input className="input" type="number" min={10} step={5} value={plan.sessionMinutes} onChange={(e) => setPlan({ ...plan, sessionMinutes: Number(e.target.value) })} /></Field>
            <div className="md:col-span-3"><Field label="Instructions"><textarea className="input" rows={2} value={plan.instructions} onChange={(e) => setPlan({ ...plan, instructions: e.target.value })} /></Field></div>
            <div className="md:col-span-3">
              <span className="label">Prescribed treatments</span>
              {items.map((it, i) => (
                <div key={i} className="mb-2 grid grid-cols-12 gap-2">
                  <select className="input col-span-3" value={it.category} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))}>
                    {CATEGORIES.map((cat) => <option key={cat}>{cat}</option>)}
                  </select>
                  <input className="input col-span-4" placeholder="Treatment / exercise" value={it.name} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <input className="input col-span-1" type="number" placeholder="Sets" value={it.sets ?? ""} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, sets: e.target.value ? Number(e.target.value) : undefined } : x)))} />
                  <input className="input col-span-1" type="number" placeholder="Reps" value={it.reps ?? ""} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, reps: e.target.value ? Number(e.target.value) : undefined } : x)))} />
                  <input className="input col-span-2" type="number" placeholder="Minutes" value={it.durationMinutes ?? ""} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, durationMinutes: e.target.value ? Number(e.target.value) : undefined } : x)))} />
                  <button type="button" className="btn-ghost col-span-1" onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
                </div>
              ))}
              <button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-gold-700" onClick={() => setItems([...items, { category: "Exercise Therapy", name: "" }])}><Plus size={14} /> Add treatment</button>
            </div>
          </div>
        )}
      </div>

      <ErrorText error={save.error} />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={() => router.back()}>Cancel</button>
        <button className="btn-primary" disabled={save.isPending}>Save consultation{makePlan ? " & activate plan" : ""}</button>
      </div>
    </form>
  );
}
