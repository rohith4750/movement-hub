"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import { fullName } from "@/lib/format";
import type { Patient, Therapist, TreatmentPlan } from "@/lib/types";
import { ErrorText, Field } from "./ui";

export const PLAN_CATEGORIES = ["Exercise Therapy", "Manual Therapy", "Myofascial Release", "Mobility", "Strength & Conditioning", "Electrotherapy", "Taping", "Dry Needling", "Hot/Cold Therapy", "Traction", "Education"];

type Item = { id?: string; category: string; name: string; sets: string; reps: string; durationMinutes: string };
const toNum = (v: string) => (v.trim() ? Number(v) : undefined);
const itemBody = (i: Item, sortOrder: number) => ({
  category: i.category,
  name: i.name.trim(),
  sets: toNum(i.sets),
  reps: toNum(i.reps),
  durationMinutes: toNum(i.durationMinutes),
  sortOrder,
});

/**
 * Create or edit a treatment plan, including its prescribed treatments.
 * - Create: pick the patient (unless `patientId` is given), saves as ACTIVE (or DRAFT if unticked).
 * - Edit: updates plan fields, then adds / updates / removes treatment items to match the form.
 */
export function PlanForm({ plan, patientId: fixedPatient, onSaved, onCancel }: { plan?: TreatmentPlan; patientId?: string; onSaved: (planId: string) => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const editing = !!plan;

  const [search, setSearch] = useState("");
  const [patientId, setPatientId] = useState(plan?.patient.id ?? fixedPatient ?? "");
  const [f, setF] = useState({
    title: plan?.title ?? "",
    diagnosis: plan?.diagnosis ?? "",
    goals: plan?.goals ?? "",
    therapistId: plan?.therapist.id ?? user?.therapistId ?? "",
    prescribedSessions: String(plan?.prescribedSessions ?? 10),
    frequencyPerWeek: String(plan?.frequencyPerWeek ?? 3),
    sessionMinutes: String(plan?.sessionMinutes ?? 30),
    instructions: plan?.instructions ?? "",
  });
  const [activate, setActivate] = useState(true);
  const [items, setItems] = useState<Item[]>(
    plan?.items.length
      ? plan.items.map((i) => ({ id: i.id, category: i.category, name: i.name, sets: i.sets?.toString() ?? "", reps: i.reps?.toString() ?? "", durationMinutes: i.durationMinutes?.toString() ?? "" }))
      : [{ category: "Exercise Therapy", name: "", sets: "", reps: "", durationMinutes: "" }],
  );

  const patients = useQuery({ queryKey: ["patients", "plan-form", search], queryFn: () => api.page<Patient>("/patients", { search, limit: 6 }), enabled: !editing && !fixedPatient });
  const therapists = useQuery({ queryKey: ["therapists"], queryFn: () => api.get<Therapist[]>("/therapists") });

  const filled = items.filter((i) => i.name.trim());
  const sessions = Number(f.prescribedSessions);
  const perWeek = Number(f.frequencyPerWeek);
  const minutes = Number(f.sessionMinutes);
  const problem = !patientId
    ? "Choose the patient"
    : !f.therapistId
        ? "Choose the physiotherapist"
        : !(sessions >= 1 && sessions <= 200)
          ? "Sessions must be 1–200"
          : !(perWeek >= 1 && perWeek <= 14)
            ? "Sessions per week must be 1–14"
            : !(minutes >= 10 && minutes <= 180)
              ? "Minutes per session must be 10–180"
              : filled.some((i) => i.name.trim().length < 2)
                ? "Each treatment needs a name (2+ letters)"
                : (activate || editing) && filled.length === 0
                  ? "Add at least one treatment"
                  : null;

  const save = useMutation({
    mutationFn: async () => {
      const fields = {
        title: f.title.trim() || undefined,
        diagnosis: f.diagnosis.trim() || undefined,
        goals: f.goals.trim() || undefined,
        instructions: f.instructions.trim() || undefined,
        prescribedSessions: sessions,
        frequencyPerWeek: perWeek,
        sessionMinutes: minutes,
        therapistId: f.therapistId,
      };
      if (!editing) {
        const p = await api.post<{ id: string }>("/treatment-plans", { ...fields, patientId, activate, items: filled.map(itemBody) });
        return p.id;
      }
      await api.patch(`/treatment-plans/${plan.id}`, fields);
      // Sync treatment items: remove deleted, update existing, add new.
      const keptIds = new Set(filled.filter((i) => i.id).map((i) => i.id));
      for (const old of plan.items) if (!keptIds.has(old.id)) await api.del(`/treatment-plans/${plan.id}/items/${old.id}`);
      for (const [n, i] of filled.entries()) {
        if (i.id) await api.patch(`/treatment-plans/${plan.id}/items/${i.id}`, itemBody(i, n));
        else await api.post(`/treatment-plans/${plan.id}/items`, itemBody(i, n));
      }
      return plan.id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["plans"] });
      qc.invalidateQueries({ queryKey: ["plan", id] });
      qc.invalidateQueries({ queryKey: ["patient"] });
      onSaved(id);
    },
  });

  const setItem = (i: number, patch: Partial<Item>) => setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <div className="space-y-4">
      {!editing && !fixedPatient && (
        <Field label="Patient *">
          <input className="input" placeholder="Search name, phone or patient code" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="mt-2 flex flex-wrap gap-2">
            {patients.data?.data.map((p) => (
              <button key={p.id} type="button" onClick={() => setPatientId(p.id)} className={clsx("rounded-lg border px-3 py-1 text-sm", patientId === p.id ? "border-gold-500 bg-gold-100" : "border-navy-100")}>
                {fullName(p)} <span className="text-navy-500">· {p.patientCode}</span>
              </button>
            ))}
          </div>
        </Field>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Plan title"><input className="input" placeholder="Optional — defaults to the diagnosis" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Treating physiotherapist *">
          <select className="input" value={f.therapistId} onChange={(e) => setF({ ...f, therapistId: e.target.value })}>
            <option value="">Select</option>
            {therapists.data?.map((t) => <option key={t.id} value={t.id}>{t.user.name}</option>)}
          </select>
        </Field>
        <Field label="Diagnosis"><input className="input" value={f.diagnosis} onChange={(e) => setF({ ...f, diagnosis: e.target.value })} /></Field>
        <Field label="Goals"><input className="input" value={f.goals} onChange={(e) => setF({ ...f, goals: e.target.value })} /></Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Sessions"><input className="input" type="number" min={1} max={200} value={f.prescribedSessions} onChange={(e) => setF({ ...f, prescribedSessions: e.target.value })} /></Field>
        <Field label="Per week"><input className="input" type="number" min={1} max={14} value={f.frequencyPerWeek} onChange={(e) => setF({ ...f, frequencyPerWeek: e.target.value })} /></Field>
        <Field label="Minutes each"><input className="input" type="number" min={10} max={180} step={5} value={f.sessionMinutes} onChange={(e) => setF({ ...f, sessionMinutes: e.target.value })} /></Field>
      </div>
      <Field label="Instructions"><textarea className="input" rows={2} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></Field>

      <div>
        <span className="label">Prescribed treatments</span>
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={it.id ?? `new-${i}`} className="grid grid-cols-12 gap-2">
              <select className="input col-span-3" value={it.category} onChange={(e) => setItem(i, { category: e.target.value })}>
                {PLAN_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
              <input className="input col-span-4" placeholder="Treatment / exercise" value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} />
              <input className="input col-span-1" type="number" min={1} placeholder="Sets" value={it.sets} onChange={(e) => setItem(i, { sets: e.target.value })} />
              <input className="input col-span-1" type="number" min={1} placeholder="Reps" value={it.reps} onChange={(e) => setItem(i, { reps: e.target.value })} />
              <input className="input col-span-2" type="number" min={1} placeholder="Minutes" value={it.durationMinutes} onChange={(e) => setItem(i, { durationMinutes: e.target.value })} />
              <button type="button" className="btn-ghost col-span-1 px-0" title="Remove treatment" onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <button type="button" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-gold-700" onClick={() => setItems([...items, { category: "Exercise Therapy", name: "", sets: "", reps: "", durationMinutes: "" }])}>
          <Plus size={14} /> Add treatment
        </button>
      </div>

      {!editing && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} /> Start the plan now (active). Untick to save as a draft.
        </label>
      )}

      <ErrorText error={save.error} />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {problem && <span className="mr-auto text-xs font-medium text-amber-700">{problem}</span>}
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-primary" disabled={!!problem || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : editing ? "Save changes" : "Create plan"}
        </button>
      </div>
    </div>
  );
}
