"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import { ageFrom, dobFromAge } from "@/lib/format";
import type { Patient } from "@/lib/types";
import { ErrorText, Field } from "./ui";

const EMPTY = { firstName: "", lastName: "", gender: "MALE", patientType: "REGULAR" as "REGULAR" | "WALK_IN", dateOfBirth: "", phone: "", email: "", referredBy: "", line1: "", city: "", state: "", pincode: "", consentGiven: true };

/**
 * Patient registration form. Used on the Patients page (dialog) and inline on the booking page.
 * `compact` = single column, fewer optional fields shown up front.
 */
export function PatientForm({ onCreated, onCancel, compact, submitLabel = "Add patient" }: { onCreated: (p: Patient) => void; onCancel?: () => void; compact?: boolean; submitLabel?: string }) {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const [f, setF] = useState(EMPTY);
  // Regular physio: defaults to the physio registering the patient.
  const [physio, setPhysio] = useState<string | null>(null);
  const therapists = useQuery({ queryKey: ["therapists"], queryFn: () => api.get<{ id: string; user: { name: string } }[]>("/therapists") });
  const primaryTherapistId = physio ?? (user?.role === "PHYSIOTHERAPIST" ? user.therapistId ?? "" : "");
  const [more, setMore] = useState(!compact);
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string; checked?: boolean; type?: string } }) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  const m = useMutation({
    mutationFn: () =>
      api.post<Patient>("/patients", {
        firstName: f.firstName.trim(),
        lastName: f.lastName.trim() || undefined,
        gender: f.gender,
        patientType: f.patientType,
        dateOfBirth: f.dateOfBirth || undefined,
        phone: f.phone,
        email: f.email.trim() || undefined,
        referredBy: f.referredBy.trim() || undefined,
        primaryTherapistId: primaryTherapistId || undefined,
        consentGiven: f.consentGiven,
        address: f.line1.trim() ? { line1: f.line1.trim(), city: f.city.trim(), state: f.state.trim(), pincode: f.pincode.trim() } : undefined,
      }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["patients"] });
      setF(EMPTY);
      setPhysio(null);
      onCreated(p);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };

  const grid = clsx("grid gap-3", compact ? "grid-cols-2" : "md:grid-cols-2 gap-4");
  const full = compact ? "col-span-2" : "md:col-span-2";

  return (
    <form onSubmit={submit} className={grid}>
      <Field label="First name *"><input className="input" required value={f.firstName} onChange={set("firstName")} autoFocus={compact} /></Field>
      <Field label="Last name"><input className="input" value={f.lastName} onChange={set("lastName")} /></Field>
      <Field label="Phone *"><input className="input" required inputMode="tel" placeholder="98765 43210" value={f.phone} onChange={set("phone")} /></Field>
      <Field label="Patient type *">
        <select className="input" value={f.patientType} onChange={set("patientType")}>
          <option value="REGULAR">Regular</option>
          <option value="WALK_IN">Walk-in</option>
        </select>
      </Field>
      <Field label="Patient type *">
        <select className="input" value={f.patientType} onChange={set("patientType")}>
          <option value="REGULAR">Regular</option>
          <option value="WALK_IN">Walk-in</option>
        </select>
      </Field>
      <Field label="Gender *">
        <select className="input" value={f.gender} onChange={set("gender")}><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option></select>
      </Field>
      <div className="grid grid-cols-[1fr_6rem] gap-2">
        <Field label="Date of birth"><input className="input" type="date" max={new Date().toISOString().slice(0, 10)} value={f.dateOfBirth} onChange={set("dateOfBirth")} /></Field>
        <Field label="Age">
          <input
            className="input"
            inputMode="numeric"
            placeholder="yrs"
            value={ageFrom(f.dateOfBirth) ?? ""}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 3);
              setF({ ...f, dateOfBirth: v && Number(v) < 130 ? dobFromAge(Number(v)) : "" });
            }}
          />
        </Field>
      </div>
      <Field label="Email"><input className="input" type="email" value={f.email} onChange={set("email")} /></Field>
      <Field label="Regular physiotherapist">
        <select className="input" value={primaryTherapistId} onChange={(e) => setPhysio(e.target.value)}>
          <option value="">None</option>
          {therapists.data?.map((t) => <option key={t.id} value={t.id}>{t.user.name}</option>)}
        </select>
      </Field>

      {compact && !more && (
        <button type="button" className={clsx(full, "text-left text-xs font-semibold text-gold-700")} onClick={() => setMore(true)}>+ Add address &amp; referral (needed for home visits)</button>
      )}
      {more && (
        <>
          <div className={full}><Field label="Address"><input className="input" value={f.line1} onChange={set("line1")} /></Field></div>
          <Field label="City"><input className="input" value={f.city} onChange={set("city")} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="State"><input className="input" value={f.state} onChange={set("state")} /></Field>
            <Field label="Pincode"><input className="input" inputMode="numeric" maxLength={6} value={f.pincode} onChange={set("pincode")} /></Field>
          </div>
          <div className={full}><Field label="Referred by"><input className="input" value={f.referredBy} onChange={set("referredBy")} /></Field></div>
        </>
      )}

      <label className={clsx(full, "flex items-center gap-2 text-sm")}>
        <input type="checkbox" checked={f.consentGiven} onChange={set("consentGiven")} /> Patient consents to treatment and data processing
      </label>
      <div className={full}><ErrorText error={m.error} /></div>
      <div className={clsx(full, "flex justify-end gap-2")}>
        {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>}
        <button className="btn-primary" disabled={m.isPending}>{m.isPending ? "Saving…" : submitLabel}</button>
      </div>
    </form>
  );
}
